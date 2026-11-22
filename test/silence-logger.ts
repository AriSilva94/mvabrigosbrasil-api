import { ConsoleLogger, Logger } from '@nestjs/common';

Logger.overrideLogger(false);
ConsoleLogger.prototype.error = () => undefined;
