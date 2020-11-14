import { IRouteRequest, RouteRequest } from 'maestro';
import { FastifyRequest } from 'fastify';
import { Adapter } from '../Adapter';

export async function TransformRequest(request: FastifyRequest): Promise<IRouteRequest> {

  let req: IRouteRequest = new RouteRequest(Adapter.ADAPTER_NAME, request.url);

  //  Request Identification in Express is List of IP's + User Agent
  let requestIdentification = (request.ips != null ? request.ips.join(' - ') : request.ip)
    + " | "
    + request.headers["user-agent"] ?? "UA-NOT-PROVIDED";
  req.identification = requestIdentification;

  let body = request.body as any ?? {};
  let query = request.query as any ?? {};
  let params = request.params as any ?? {};

  // Add Header parameters
  for (let headerName in request.headers) {
    req.add(
      headerName,
      request.headers[headerName],
      'header'
    );
  }

  // Add Cookie parameters
  for (let cookieName in request.cookies) {
    req.add(
      cookieName,
      request.cookies[cookieName],
      'cookie'
    );
  }

  // Add Body parameters
  for (let bodyName in body) {
    req.add(
      bodyName,
      body[bodyName],
      'body'
    );
  }

  // Add QueryString parameters
  for (let qsName in query) {
    req.add(
      qsName,
      query[qsName],
      'query'
    );
  }

  // Add URL parameters
  for (let urlName in params) {
    req.add(
      urlName,
      params[urlName],
      'url'
    );
  }

  /*for await (let singleFile of files) {
    req.addParameter(
      singleFile.fieldname,
      singleFile,
      FastifyFileOrigin
    );
  }*/

  return req;
}
