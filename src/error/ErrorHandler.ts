import { ApiError, ApiException } from 'maestro';
import { FastifyReply } from 'fastify';

export function ErrorHandler(
	response: FastifyReply,
	error: ApiError | ApiException | Error | any,
	resolve: (value?: any) => void,
	reject: (reason?: any) => void
) {

	let errorPayload: ErrorPayload = {
		exitCode: 'REQUEST_REFUSED',
		message: error.message
	};

	if (typeof error.exitCode === 'string') {
		errorPayload.exitCode = error.exitCode;
	}

	if (typeof error.httpStatus! === 'number') {
		response.status(error.httpStatus!);
		resolve(errorPayload);
	} else {
		response.status(500);
		reject(errorPayload);
	}

}

type ErrorPayload = {
	exitCode: string;
	message: string;
	reason?: string;
};