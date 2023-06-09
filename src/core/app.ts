import * as CoreJS from "corejs";

export interface AppConfig {
    readonly name: string;
}

export abstract class App {
    public readonly onMessage = new CoreJS.Event<App, string>('App.onMessage');

    public readonly name: string;

    constructor(config: AppConfig) {
        this.name = config.name;

        process.on('message', async (message: string) => {
            const senderLength = message.indexOf(' ');
            const sender = message.substring(0, senderLength);
            const command = message.substring(senderLength + 1);
            const result = await this.executeLine(command);

            process.send(`${sender} ${result}`);
        });
    }

    public abstract close();
    public abstract execute(command?: string, args?: {}): Promise<CoreJS.Response>;
    public abstract executeLine(commandLine: string): Promise<CoreJS.Response>;
}