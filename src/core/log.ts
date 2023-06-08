import * as FS from "fs";
import * as CoreJS from "corejs";

export class Log {
    constructor(private readonly stream: NodeJS.WritableStream) { }

    public static createFileLog(filePath: string, clear = false) {
        const stream = FS.createWriteStream(filePath, {
            flags: clear ? 'w' : 'a'
        });

        return new Log(stream);
    }

    public close() {
        this.stream.end();
    }

    public write(text: string | Buffer, title?: string): void {
        this.stream.write(`${CoreJS.formatDateTime(new Date(), { seconds: true })} >> ${title ? title + ': ' + text : text}\n`);
    }

    public warning(text: string, title?: string): void {
        this.write(`warning: ${title ? title + ': ' + text : text}`);
    }

    public error(error: Error, title?: string): void {
        this.write(title ? title + ': ' + error.stack : error.stack);
    }
}