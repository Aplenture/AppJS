import * as CoreJS from "corejs";
import * as LogJS from "logjs";
import { App } from "./core";

const command = process.argv[2];
const args = CoreJS.parseArgsFromString(process.argv.slice(3).join(' '));

const config = CoreJS.loadConfig<any>();
const app = new App(config, args);

const log = LogJS.Log.createFileLog('./' + app.name + '.log');

process.title = app.name;

process.on('exit', code => code && log.write("exit with code " + code));
process.on('SIGINT', () => app.close().then(() => process.exit()));
process.on('SIGUSR1', () => app.close().then(() => process.exit()));
process.on('SIGUSR2', () => app.close().then(() => process.exit()));
process.on('uncaughtException', error => log.error(error));
process.on('unhandledRejection', reason => log.error(reason instanceof Error ? reason : reason ? new Error(reason.toString()) : new Error()));

app.onMessage.on(message => log.write(message));
app.onError.on(error => log.error(error));
app.init(config.flags)
    .then(() => app.execute(command, args))
    .then(result => process.stdout.write(result.data))
    .catch(error => process.stdout.write(error.stack))
    .then(() => app.close())
    .then(() => process.exit());