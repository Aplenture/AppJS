/**
 * Aplenture/AppJS
 * https://github.com/Aplenture/AppJS
 * Copyright (c) 2023 Aplenture
 * MIT License https://github.com/Aplenture/AppJS/blob/main/LICENSE
 */

import * as BackendJS from "backendjs";
import * as CoreJS from "corejs";
import * as FS from "fs";
import * as HTTP from "http";
import { App, Server } from "./core";

const PARAMETER_LOGFILE = 'logfile';

const command = process.argv[2];
const route = process.argv[3] && 0 != process.argv[3].indexOf('-')
    ? process.argv[3]
    : '';

const globalArgs = CoreJS.parseArgsFromString(process.argv.slice(route ? 4 : 3).join(' '));

const commander = new CoreJS.Commander();
const config = new CoreJS.Config(...App.Parameters, ...Server.Parameters, ...BackendJS.Module.GlobalParameters);
const infos = BackendJS.loadConfig('package.json');

config.add(new CoreJS.StringParameter(PARAMETER_LOGFILE, 'file path of log file', './app.log'));
config.set(App.PARAMETER_VERSION, infos.version);
config.deserialize(BackendJS.loadConfig('configs/config.json'));
config.deserialize(globalArgs);

commander.set({
    name: 'start',
    description: "starts the server",
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('config', 'filepath of additional config', 'server')
    ),
    execute: async args => {
        const additionalConfigPath: string = args.config;

        delete args.config;

        // deserialize additional config
        if (additionalConfigPath)
            await commander.execute('config.load', { path: additionalConfigPath });

        const log = BackendJS.Log.Log.createFileLog(config.get(PARAMETER_LOGFILE));

        process.on('exit', code => code && log.write("exit with code " + code));
        process.on('SIGINT', () => log.close().then(() => process.exit()));
        process.on('SIGUSR1', () => log.close().then(() => process.exit()));
        process.on('SIGUSR2', () => log.close().then(() => process.exit()));
        process.on('uncaughtException', error => log.error(error));
        process.on('unhandledRejection', reason => log.error(reason instanceof Error ? reason : reason ? new Error(reason.toString()) : new Error()));

        const app = new App(config, args);
        const server = new Server(app, config);

        process.title = app.name;

        app.onMessage.on(message => log.write(message));
        app.onError.on(error => log.error(error));

        server.onMessage.on(message => log.write(message));
        server.onError.on(error => log.error(error));

        await app.init();

        server
            .start()
            .then(() => app.deinit())
            .then(() => log.close());

        return "server started\n";
    }
});

commander.set({
    name: 'exec',
    description: 'sends request to a server instance',
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('config', 'filepath of additional config', 'local'),
        new CoreJS.BoolParameter('start', 'starts server if it is not running already', true),
    ),
    execute: async args => {
        const additionalConfigPath: string = args.config;
        const start: boolean = args.start;

        delete args.config;
        delete args.start;

        // deserialize additional config
        if (additionalConfigPath)
            await commander.execute('config.load', { path: additionalConfigPath });

        return await new Promise<string>((resolve, reject) => {
            const params = CoreJS.URLArgsToString(args);
            const path = params
                ? `/${route}?${params}`
                : `/${route}`;

            const request = HTTP.request({
                host: config.get(Server.PARAMETER_HOST),
                port: config.get(Server.PARAMETER_PORT),
                path,
                method: 'GET'
            }, response => {
                let data = '';

                response.on('error', reject);
                response.on('data', chunk => data += chunk);
                response.on('close', () => {
                    switch (response.statusCode) {
                        case CoreJS.ResponseCode.OK:
                            resolve(data.toString());
                            break;

                        default:
                            resolve(`Error ${response.statusCode}: ${data.toString()}`);
                            break;
                    }
                });
            });

            request.on('error', (error: any) => {
                switch (error.errno) {
                    // server is not running
                    case -111: //ECONNREFUSED
                        if (!start)
                            return resolve('server is not running\n');

                        // starts the server
                        // and retry exec
                        return commander
                            .execute('start', { config: '' })
                            .then(() => commander.execute('exec', Object.assign({}, args, {
                                config: '',
                                start: false
                            })))
                            .then(resolve)
                            .catch(reject);

                    default:
                        return reject(error);
                }
            });

            request.end();
        });
    }
});

commander.set({
    name: 'config.get',
    description: "returns the config",
    parameters: new CoreJS.ParameterList(
        new CoreJS.NumberParameter('space', 'serialization option space', 4)
    ),
    execute: async args => JSON.stringify(config, null, args.space)
});

commander.set({
    name: 'config.load',
    description: "loads an additional config file",
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('path', 'config file path')
    ),
    execute: async args => {
        const path = `configs/${args.path}.json`;

        if (!FS.existsSync(path))
            return `not existing config file at '${path}'`;

        config.deserialize(BackendJS.loadConfig(path));
        config.deserialize(globalArgs);

        return `additional config loaded from '${path}'`;
    }
});

commander.set({
    name: 'config.create',
    description: "writes config to file",
    parameters: new CoreJS.ParameterList(
        new CoreJS.NumberParameter('space', 'serialization option space', 4),
        new CoreJS.ArrayParameter('path', 'config file path', new CoreJS.StringParameter('', ''), ['config']),
        new CoreJS.BoolParameter('force', 'overwrites existing config file', false)
    ),
    execute: async args => {
        const result = await Promise.all(args.path.map(async path => {
            path = `configs/${path}.json`;

            if (FS.existsSync(path) && !args.force)
                return `config file already exist at '${path}'`;

            FS.writeFileSync(path, JSON.stringify(config, null, args.space));

            return `config written to file at '${path}'`;
        }));

        return result.join('\n') + '\n';
    }
});

commander.set({
    name: 'config.clear',
    description: "clears the config file",
    execute: async args => {
        await BackendJS.Log.Log.clear(config.get(PARAMETER_LOGFILE));

        return `config cleared\n`;
    }
});

commander
    .execute(command, globalArgs)
    .then(result => process.stdout.write(result))
    .catch(error => process.stdout.write(error.stack))
    .then(() => process.exit()); 