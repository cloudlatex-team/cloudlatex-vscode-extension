export default class Logger {
  info(message: any, ...optinalParams: any[]) {
    console.info(message, ...optinalParams);
  }

  warn(message: any, ...optinalParams: any[]) {
    console.warn(message, ...optinalParams);
  }

  error(message: any, ...optinalParams: any[]) {
    console.error(message, ...optinalParams);
  }
}
