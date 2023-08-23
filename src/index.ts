/**
 * Aplenture/AppJS
 * https://github.com/Aplenture/AppJS
 * Copyright (c) 2023 Aplenture
 * MIT License https://github.com/Aplenture/AppJS/blob/main/LICENSE
 */

import * as BackendJS from "backendjs";
import * as CoreJS from "corejs";
import { App } from "./core";

const command = process.argv[2];
const args = CoreJS.Args;
const app = new App();

app.init(args);

process.title = app.name;

const log = BackendJS.Log.createFileLog('./' + app.name + '.log');

process.on('exit', code => code && log.write("exit with code " + code));
process.on('SIGINT', () => app.close().then(() => process.exit()));
process.on('SIGUSR1', () => app.close().then(() => process.exit()));
process.on('SIGUSR2', () => app.close().then(() => process.exit()));
process.on('uncaughtException', error => log.error(error));
process.on('unhandledRejection', reason => log.error(reason instanceof Error ? reason : reason ? new Error(reason.toString()) : new Error()));

app.onMessage.on(message => log.write(message));
app.onError.on(error => log.error(error));
app.load()
    .then(() => app.execute(command, args))
    .then(result => process.stdout.write(result.data))
    .catch(error => process.stdout.write(error.stack))
    .then(() => app.close())
    .then(() => process.exit());