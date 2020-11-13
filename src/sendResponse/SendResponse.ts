import { ICommand, IApiRouteResponse } from 'auria-maestro';
import { FastifyReply } from 'fastify';
import { Adapter } from '../Adapter';
import { Commands } from '../commands/Commands';

export function SendResponse(
	routeResp: IApiRouteResponse,
	response: FastifyReply,
	resolve: (value?: any) => void
) {

	// Cannot resolve a promise with null/undefined!
	let send = routeResp.payload ?? {};
	if (routeResp.commands != null) {
		applyCommandsToResponse(
			response,
			routeResp.commands
		);
	}

	response
		.header(
			'X-Exit-Code',
			routeResp.exitCode
		);

	response
		.status(routeResp.status);

	resolve(send);
}

function applyCommandsToResponse(response: FastifyReply, commands: ICommand | ICommand[]) {

	if (Array.isArray(commands)) {
		for (let command of commands!) {
			applyCommandsToResponse(response, command);
		}
	} else {
		// Accepts array of adapters?
		if (Array.isArray(commands.adapters)) {
			// Is Fastify not one of them?
			if (!commands.adapters.includes(Adapter.ADAPTER_NAME)) {
				return;
			}
		}

		// Unspecified adapter or Express adapter ?
		if (commands.adapters == null || commands.adapters === Adapter.ADAPTER_NAME) {
			// Known command ?
			if ((Commands as any)[commands.name] != null) {
				(Commands as any)[commands.name](response, commands.payload);
			}
		}
	}
}