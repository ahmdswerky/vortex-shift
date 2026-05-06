"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHECKPOINT_SCHEMA_VERSION = exports.CHECKPOINT_FILE = void 0;
exports.loadCheckpoint = loadCheckpoint;
exports.saveCheckpoint = saveCheckpoint;
exports.clearCheckpoint = clearCheckpoint;
exports.markStepComplete = markStepComplete;
exports.markStepFailed = markStepFailed;
exports.isStepDone = isStepDone;
exports.displayCheckpointSummary = displayCheckpointSummary;
const node_path_1 = __importDefault(require("node:path"));
const fs_js_1 = require("../utils/fs.js");
const CHECKPOINT_FILE = 'checkpoint.json';
exports.CHECKPOINT_FILE = CHECKPOINT_FILE;
const CHECKPOINT_SCHEMA_VERSION = 1;
exports.CHECKPOINT_SCHEMA_VERSION = CHECKPOINT_SCHEMA_VERSION;
function getCheckpointPath(dir) {
    return node_path_1.default.join(dir, CHECKPOINT_FILE);
}
async function loadCheckpoint(dir) {
    const checkpointPath = getCheckpointPath(dir);
    if (!(await (0, fs_js_1.fileExists)(checkpointPath))) {
        return null;
    }
    const parsed = await (0, fs_js_1.readJson)(checkpointPath);
    const version = parsed.version ?? 0;
    if (version > CHECKPOINT_SCHEMA_VERSION) {
        throw new Error(`Unsupported checkpoint schema version ${version}. Supported version is ${CHECKPOINT_SCHEMA_VERSION}.`);
    }
    const normalized = {
        ...parsed,
        version: CHECKPOINT_SCHEMA_VERSION,
    };
    if (version !== CHECKPOINT_SCHEMA_VERSION) {
        await saveCheckpoint(dir, normalized);
    }
    return normalized;
}
async function saveCheckpoint(dir, state) {
    await (0, fs_js_1.ensureDir)(dir);
    await (0, fs_js_1.writeJson)(getCheckpointPath(dir), state);
}
async function clearCheckpoint(dir) {
    const checkpointPath = getCheckpointPath(dir);
    if (!(await (0, fs_js_1.fileExists)(checkpointPath))) {
        return;
    }
    const fs = await Promise.resolve().then(() => __importStar(require('node:fs/promises')));
    await fs.unlink(checkpointPath);
}
function markStepComplete(state, stepId) {
    if (!state.completedSteps.includes(stepId)) {
        state.completedSteps.push(stepId);
    }
    state.failedStep = null;
    state.error = null;
    state.lastUpdatedAt = new Date().toISOString();
    return state;
}
function markStepFailed(state, stepId, error) {
    state.failedStep = stepId;
    state.error = error;
    state.lastUpdatedAt = new Date().toISOString();
    return state;
}
function isStepDone(state, stepId) {
    return state.completedSteps.includes(stepId);
}
function displayCheckpointSummary(state, logger) {
    logger.info('Checkpoint found. Resuming migration state:');
    logger.info(`  phase: ${state.phase}`);
    logger.info(`  completed steps: ${state.completedSteps.length}`);
    if (state.failedStep) {
        logger.warn(`  last failed step: ${state.failedStep}`);
    }
    logger.info(`  started at: ${state.startedAt}`);
    logger.info(`  last updated: ${state.lastUpdatedAt}`);
}
