import { EventEmitter } from 'events';
import fastify, { FastifyInstance, FastifyReply, FastifyRequest, FastifyServerOptions } from 'fastify';
import fastifyCookie, { CookieSerializeOptions } from 'fastify-cookie';
import fastifyHelmet from 'fastify-helmet';
import fastifyMultipart from 'fastify-multipart';
import { Server } from 'http';
import { ErrorHandler } from './error/ErrorHandler';
import { Events } from './events/Events';
import { SendResponse } from './sendResponse/SendResponse';
import { TransformRequest } from './transformRequest/TransformRequest';
import { Container, HTTPMethod, IAdapter, ICommand, IContainer, IProxiedRoute, Maestro, RequestFlowNotDefined } from 'maestro';

export class Adapter extends EventEmitter implements IAdapter {

  public static ADAPTER_NAME = "Fastify";

  public static CreateCookie = (name: string, value: string, options: CookieSerializeOptions) => {
    let command: ICommand = {
      name: 'create-cookie',
      adapters: [Adapter.ADAPTER_NAME],
      payload: {
        name,
        value,
        ...options
      }
    };

    return command;
  };

  get name(): string {
    return Adapter.ADAPTER_NAME;
  }

  get port(): number {
    return this._port;
  }

  /**
   * Fastify application
   * -------------------
   * Holds the actual fastify application
   * 
   */
  protected fastify: FastifyInstance;

  /**
   * Containers
   * ------------
   * Hold all the API Containers that will be exposed to the 
   * Fastify Adapter
   */
  protected containers: Container[] = [];

  /**
   * Port
   * ----
   * Which port the adapter will run
   */
  protected _port: number = Number(process.env.FASTIFY_PORT) ?? 3333;

  /**
   * Booted
   * -------
   * Boot state of the adapter
   */
  protected _booted = false;

  /**
   * Started
   * --------
   * Start state of the adapter
   */
  protected _started = false;

  /**
   * Server
   * ------
   * HTTP Server created when the adapter is started
   */
  protected _server?: Server;

  /**
   * Loaded Routes
   * --------------
   * All Routes that were already 'loaded'
   * and are therefore exposed 
   */
  protected _loadedRoutes: IProxiedRoute[] = [];

  /**
   * Transform Request
   * -----------------
   * Holds the function that shall normalize a Request input
   * into an *IApiRouteRequest*
   */
  protected _transformRequest: typeof TransformRequest = TransformRequest;

  /**
   * Send Response
   * ---------------
   * Holds the function that shall output an IApiRouteResponse
   * as an actual HTTP Response (usually in JSON format)
   */
  protected _sendResponse: typeof SendResponse = SendResponse;

  /**
   * Request Handler
   * ---------------
   * Responsible for orchestrating the flow of a request
   * Steps taken by the default flow:
   * 1. Transform Request
   * 2. Call the API Request Handler set in the adapter (Usually an APIMaestro handle function)
   * > 2.1 The API Handler has access to a normalized function to either send the IApiRouteResponse
   * > or an error
   * 
   * @param route Route that the request is directed to
   * @param method Http method used to fetch the request
   * @param request Fastify Request object
   * @param response Fastify Response object
   */
  protected _requestHandler = async (
    route: IProxiedRoute,
    method: HTTPMethod,
    request: FastifyRequest,
    matchedPattern: string,
    response: FastifyReply
  ) => {
    let returnToFastify = new Promise<any>(async (resolve, reject) => {

      if (typeof this._apiHandler !== "function") {
        let error = new RequestFlowNotDefined(
          'Fastify adapter does not have an associated api request handler'
        );
        this._errorHandler(
          response,
          error,
          resolve,
          reject
        );
        this.emit(Events.REQUEST_ERROR, error, route, request);
      }

      // Create API Request
      let apiRequest = await this._transformRequest(request, matchedPattern);
      apiRequest.method = method;

      // Send it to API Handler
      this._apiHandler!(
        route,
        apiRequest,
        (routeResp) => {
          this._sendResponse(routeResp, response, resolve);
          this.emit(Events.REQUEST_RESPONSE, routeResp, route);
        },
        (error) => {
          this._errorHandler(response, error, resolve, reject);
          this.emit(Events.REQUEST_ERROR, error, route, request);
        }
      );
    });

    return returnToFastify;

  };

  /**
   * Actual API Handler
   * -------------------
   * Fastify adapter is only responsible for normalizing the Input/Output
   * of the API, therefore properly translating the Fastify request
   * into an *IApiRouteRequest* and them outputting the *IApiRouteResponse*
   * 
   * All other steps should be done by an 'api request handler', how this handler
   * will manage all the processes of validating the request, calling the resolver
   * checking for possible errors and so on is no concern to the adapter!
   */
  protected _apiHandler?: Maestro['handle'];

  /**
   * Error Handler
   * --------------
   * Function that allows the API Handler to output errors through the default
   * Fastify Error Handler or any other adapter error handler
   */
  protected _errorHandler: typeof ErrorHandler = ErrorHandler;

  constructor(options?: FastifyServerOptions);
  constructor(port: number, options?: FastifyServerOptions);
  constructor(portOrOptions?: number | FastifyServerOptions, options?: FastifyServerOptions) {
    super();

    if (typeof portOrOptions === 'number') {
      this.fastify = fastify(options);
      this.onPort(portOrOptions);
    } else {
      this.fastify = fastify(options);
    }
  }

  /**
   * [SET] Transform Request Function
   * ---------------------------------
   * Defines the function that the adapter will use to
   * transform an Fastify Reply into an *iApiRouteRequest*
   * 
   * @param func 
   */
  setTransformRequestFunction(func: typeof TransformRequest) {
    this._transformRequest = func;
  }

  /**
   * [SET] Send Response
   * --------------------
   * Defines the function that will output through fastify
   * an *IApiResponse* object
   * 
   * @param func 
   */
  setSendResponseFunction(func: typeof SendResponse) {
    this._sendResponse = func;
  }

  /**
   * [SET] Error Handler
   * -------------------
   * Defines how the adapter will output errors
   * @param handler 
   */
  setErrorHandler(handler: typeof ErrorHandler) {
    this._errorHandler = handler;
  }

  /**
   * [SET] Request Handler
   * ----------------------
   * Defines the function that will actually be responsible
   * for transforming the IApiRouteRequest into an IAPiRouteResponse
   * 
   * All other steps like parameter validation, schema validation
   * check for errors must be done by this handler
   * 
   * @param handler 
   */
  setRequestHandler(handler: Maestro['handle']) {
    this._apiHandler = handler;
  }

  /**
   * [ADD] API Container
   * --------------------
   * Add a new API Container to the fastify adapter
   * exposing its routes as accessible URL's when
   * the adapter in started
   * 
   * @param container 
   */
  addContainer(container: Container) {
    // Prevent duplicates
    if (!this.containers.includes(container)) {
      this.containers.push(container);
    }
  }

  boot() {

    if (this._booted) return;

    // Add needed fastify capabilities
    this.fastify.register(fastifyCookie, {
      secret: '',
    });

    this.fastify.register(fastifyHelmet);

    this.fastify.register(fastifyMultipart);

    console.debug("\nRoute Descriptions:\n----------------------\n");
    // Add all routes from currently known containers
    this.loadRoutesFromContainers(this.containers);
    console.debug();
    this._booted = true;
  }

  /**
   * Load Routes From Containers
   * ---------------------------
   * Crawls into the container fetching all exposed routes
   * Assign them to the fastify server using the adapters
   * *Request Handler*
   * 
   * @param containers All Containers that will have their api routes exposed
   */
  loadRoutesFromContainers(containers: IContainer[]) {

    for (let container of containers) {
      const allRoutes = container.allRoutes();

      for (let route of allRoutes) {
        // Already loaded? Do not add duplicates
        if (this._loadedRoutes.includes(route)) {
          continue;
        }
        let methods: HTTPMethod[];

        if (!Array.isArray(route.methods)) {
          methods = [route.methods];
        } else {
          methods = route.methods;
        }

        this.describeRoute(route, methods);

        // methods.forEach(
        //   m => console.debug(`${m.toLocaleUpperCase()}\t- ${route.url}`)
        // );
        for (let method of methods) {
          this.addRouteToHttpMethod(method, route);
        }

        this._loadedRoutes.push(route);

      }
    }
  }

  public describeRoute(route: IProxiedRoute, methods: HTTPMethod[]) {

    console.log(
      '\x1b[1m• ' + route.url + ' \x1b[0m'
      + `[${methods.map(m => {
        return `\x1b[93m${m.toLocaleUpperCase()}`;
      }).join(',')
      }` + '\x1b[0m]',
    );

    if (typeof route.resolver === 'string') {
      console.log(
        '\x1b[92m' + 'Handler:',
        '\x1b[90m', route.controller.constructor.name + '.'
        + '\x1b[0m' + route.resolver
      );
    } else {
      console.log(
        '\x1b[92m' + 'Handler: ',
        '\x1b[90m', route.controller.constructor.name + '.'
        + '\x1b[0m' + route.resolver.name
      );
    }

    if (route.requestProxies.length > 0) {
      console.log(
        '\x1b[1m\x1b[35m' + 'Request Proxy:\x1b[0m' + route.requestProxies.map(p => "\n- " + p.name).join('')
      );
    }

    if (route.responseProxies.length > 0) {
      console.log(
        '\x1b[1m\x1b[34m' + 'Response Proxy:\x1b[0m' + route.responseProxies.map(p => "\n- " + p.name).join('')
      );
    }

    console.log();
  }
  /**
   * Add Route to HTTP Method
   * ------------------------
   * Actually binds the Api Route resolver to the URL + Method
   * it is assigned to into the fastify app;
   * 
   * @param method HTTPMethod that will be listened
   * @param route Route corresponding to the URL + Method
   */
  protected addRouteToHttpMethod(method: HTTPMethod, route: IProxiedRoute) {
    let url: string;

    if (route.url.trim().charAt(0) !== '/') {
      url = '/' + route.url.trim();
    } else {
      url = route.url.trim();
    }

    // Handle 'search' http method, currently unsupported by fastify - Transformed into 'ALL'
    if (['search', 'all'].includes(method)) {
      console.warn(
        'Fastify adapter does not support "' + method.toLocaleUpperCase() + '" HTTP verb, serving route as POST instead'
      );
      method = 'post';
    }

    this.fastify.route(
      {
        method: method.toLocaleUpperCase() as any,
        url,
        handler: async (req, res) => {
          return await this._requestHandler(route, method, req, url, res);
        },
      }
    );

    switch (method) {
      case 'all':
        this.emit(Events.ALL_REQUEST, route);
        break;
      case 'get':
        this.emit(Events.GET_REQUEST, route);
        break;
      case 'post':
        this.emit(Events.POST_REQUEST, route);
        break;
      case 'put':
        this.emit(Events.PUT_REQUEST, route);
        break;
      case 'patch':
        this.emit(Events.PATCH_REQUEST, route);
        break;
      case 'delete':
        this.emit(Events.DELETE_REQUEST, route);
        break;
      case 'head':
        this.emit(Events.HEAD_REQUEST, route);
        break;
      case 'options':
        this.emit(Events.OPTIONS_REQUEST, route);
        break;
      case 'connect':
        this.emit(Events.CONNECT_REQUEST, route);
        break;
      case 'trace':
        this.emit(Events.TRACE_REQUEST, route);
        break;
    }

    this.emit(Events.REQUEST, route, method);

  }

  /**
   * On Port
   * --------
   * Defines the port the server should be started at
   * Cannot be modified once the server has started
   * 
   * @param port 
   */
  onPort(port: number) {
    if (this._started) return;
    this._port = port;
  }

  start() {
    this.boot();
    this.fastify.listen(this._port > 0 ? this._port : 3031);
    this._server = this.fastify.server;
    this._started = true;
  }

  stop() {
    if (this._started) {
      this._server!.close();
      this._started = false;
    }
  }

  loadedRoutes(): RoutesByURL {
    let loaded: RoutesByURL = {};
    for (let route of this._loadedRoutes)
      loaded[route.url] = route;

    return loaded;
  }

}

type RoutesByURL = {
  [routeURL: string]: IProxiedRoute;
};

const ConsoleMethodColor: {
  [method in HTTPMethod]: string
} = {
  all: '97',
  connect: '97',
  delete: '91',
  get: '92',
  head: '35',
  options: '35',
  patch: '93',
  post: '96',
  put: '94',
  search: '35',
  trace: '35'
};