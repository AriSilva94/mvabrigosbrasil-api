import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (status >= 500) {
        this.logger.error(exception.stack ?? exception.message);
      }

      if (
        typeof payload === 'object' &&
        payload !== null &&
        'error' in payload &&
        typeof payload.error === 'string' &&
        !('statusCode' in payload)
      ) {
        const body: { error: string; code?: string; details?: unknown } = {
          error: payload.error,
        };
        // Código estável para o frontend decidir o que mostrar sem comparar
        // a mensagem em pt-BR.
        if ('code' in payload && typeof payload.code === 'string') {
          body.code = payload.code;
        }
        if ('details' in payload) {
          body.details = (payload as { details?: unknown }).details;
        }
        res.status(status).json(body);
        return;
      }
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ??
            HttpStatus[status] ??
            'Erro interno do servidor');
      res
        .status(status)
        .json({ error: Array.isArray(message) ? message[0] : message });
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
}
