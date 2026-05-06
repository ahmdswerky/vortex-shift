"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.confirm = confirm;
exports.input = input;
exports.select = select;
exports.pause = pause;
const inquirer_1 = __importDefault(require("inquirer"));
async function confirm(message, defaultYes = true) {
    const { value } = await inquirer_1.default.prompt([
        {
            type: 'confirm',
            name: 'value',
            message,
            default: defaultYes,
        },
    ]);
    return value;
}
async function input(message, defaultValue) {
    const { value } = await inquirer_1.default.prompt([
        {
            type: 'input',
            name: 'value',
            message,
            default: defaultValue,
        },
    ]);
    return value;
}
async function select(message, choices) {
    const { value } = await inquirer_1.default.prompt([
        {
            type: 'list',
            name: 'value',
            message,
            choices,
        },
    ]);
    return value;
}
async function pause(message = 'Press Enter to continue') {
    await inquirer_1.default.prompt([
        {
            type: 'input',
            name: 'value',
            message,
        },
    ]);
}
