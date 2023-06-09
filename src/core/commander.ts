import * as CoreJS from "corejs";

export class Commander extends CoreJS.Commander {
    public async executeCLI() {
        const command = process.argv.slice(2).join(' ');
        const result = await this.executeLine(command);

        if (undefined != result)
            process.stdout.write(result.toString());
        else
            process.stdout.write('OK\n');

        return result;
    }
}