import {
  BadRequestException,
  HttpException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

function run(exc: unknown) {
  const json = jest.fn<undefined, [unknown]>(() => undefined);
  const status = jest.fn<{ json: typeof json }, [number]>(() => ({ json }));
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as never;
  new HttpExceptionFilter().catch(exc, host);
  return {
    status: status.mock.calls[0][0],
    body: json.mock.calls[0][0],
  };
}

describe('HttpExceptionFilter', () => {
  it('maps string message', () => {
    expect(
      run(new BadRequestException('E-mail e senha são obrigatórios')),
    ).toEqual({
      status: 400,
      body: { error: 'E-mail e senha são obrigatórios' },
    });
  });
  it('keeps object body (dynamics style)', () => {
    expect(
      run(
        new BadRequestException({
          error: 'invalid_payload',
          details: { a: 1 },
        }),
      ).body,
    ).toEqual({ error: 'invalid_payload', details: { a: 1 } });
  });
  it('hides unknown errors', () => {
    expect(run(new Error('boom'))).toEqual({
      status: 500,
      body: { error: 'Erro interno do servidor' },
    });
  });
  it('passes HttpException 500 message through', () => {
    expect(
      run(new InternalServerErrorException('Erro ao salvar cadastro')).body,
    ).toEqual({ error: 'Erro ao salvar cadastro' });
  });
  it('does not leak class name for HttpException without message', () => {
    expect(run(new HttpException({}, 403)).body).toEqual({
      error: 'FORBIDDEN',
    });
  });
  it('falls back to a generic message for a status outside HttpStatus', () => {
    expect(run(new HttpException({}, 599)).body).toEqual({
      error: 'Erro interno do servidor',
    });
  });
  it('drops extra keys from the passthrough payload', () => {
    expect(
      run(
        new BadRequestException({
          error: 'invalid_payload',
          detail: { secret: 'x' },
        }),
      ).body,
    ).toEqual({ error: 'invalid_payload' });
  });
  it('logs a 5xx HttpException', () => {
    const spy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    run(new InternalServerErrorException('Erro ao salvar cadastro'));
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
  it('does not log a 4xx HttpException', () => {
    const spy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    run(new BadRequestException('bad input'));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
