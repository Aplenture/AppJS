import * as CoreJS from "corejs";
import * as ChildProcess from "child_process";
import { App, AppConfig } from "../core";

export interface ChildAppConfig extends AppConfig {
    readonly path: string;
}

export class ChildApp extends App {
    public readonly onResponse = new CoreJS.Event<number, string>('ChildApp.onResponse');

    private readonly childProcess: ChildProcess.ChildProcess;

    private _messageCounter = 0;

    constructor(config: ChildAppConfig) {
        super(config);

        this.childProcess = ChildProcess.fork(config.path);
        this.childProcess.on('message', (message: string) => {
            const senderLength = message.indexOf(' ');
            const sender = Number(message.substring(0, senderLength));
            const response = message.substring(senderLength + 1);

            this.onResponse.emit(sender, response);
        });
    }

    public close() {
        this.childProcess.disconnect();
    }

    public execute(command?: string, args?: {}): Promise<CoreJS.Response> {
        const params = CoreJS.parseArgsToString(args);

        return this.executeLine(`${command} ${params}`);
    }

    public executeLine(commandLine: string): Promise<CoreJS.Response> {
        const sender = ++this._messageCounter;

        return new Promise<CoreJS.Response>((resolve, reject) => {
            this.onResponse.once(message => resolve(CoreJS.Response.fromString(message)), { sender });
            this.childProcess.send(`${sender} ${commandLine}`, error => {
                if (!error)
                    return;

                this.onResponse.off({ sender });

                reject(error);
            });
        });
    }
}