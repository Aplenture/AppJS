import * as CoreJS from "corejs";

export class Commander extends CoreJS.Commander {
    public executeCLI() {
        const command = process.argv.slice(2).join(' ');

        return this.executeLine(command);
    }
}