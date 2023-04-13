import * as jsonc from 'jsonc-parser';

import { Argv } from 'yargs';
import { Log, LogLevel, mapLogLevel } from '../../spec-utils/log';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { FNode, buildDependencyGraphFromUserId, computeDependsOnInstallationOrder } from '../../spec-configuration/containerFeaturesOrder';
import { readLocalFile } from '../../spec-utils/pfs';
import { DevContainerConfig } from '../../spec-configuration/configuration';

export function featuresInfoDependsOnOptions(y: Argv) {
	return y
		.options({
			'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' },
			'feature': { alias: 'f', type: 'string', description: 'Feature ID.' },
			'config': { alias: 'c', type: 'string', description: 'Path to the configuration file (devcontainer.json) ' },
			'raw': { type: 'boolean', description: 'Output raw data.', default: false },
		})
		.check(argv => {
			if (argv.feature && argv.config) {
				throw new Error('Cannot specify both --feature and --config.');
			}
			if (!argv.feature && !argv.config) {
				throw new Error('Must specify either --feature or --config.');
			}
			return true;
		});
}

export type FeaturesInfoDependsOnArgs = UnpackArgv<ReturnType<typeof featuresInfoDependsOnOptions>>;

export function featureInfoDependsOnHandler(args: FeaturesInfoDependsOnArgs) {
	(async () => await featuresInfoDependsOn(args))().catch(console.error);
}

async function featuresInfoDependsOn({
	'feature': featureId,
	'config': configPath,
	'log-level': inputLogLevel,
	'raw': raw,
	// 'output-format': outputFormat,
}: FeaturesInfoDependsOnArgs) {
	const disposables: (() => Promise<unknown> | undefined)[] = [];
	const dispose = async () => {
		await Promise.all(disposables.map(d => d()));
	};

	const pkg = getPackageConfig();

	const output = createLog({
		logLevel: mapLogLevel(inputLogLevel),
		logFormat: 'text',
		log: (str) => process.stderr.write(str),
		terminalDimensions: undefined,
	}, pkg, new Date(), disposables, true);

	const params = { output, env: process.env };


	if (featureId) {
		output.write(`Building dependency graph for '${featureId}'...`, LogLevel.Info);
		const graph = await buildDependencyGraphFromUserId(params, featureId);
		if (!graph) {
			output.write(`Could not build dependency graph.`, LogLevel.Error);
			process.exit(1);
		}

		if (raw) {
			output.write(JSON.stringify(graph, undefined, 2), LogLevel.Info);
		}

		// -- Display the graph with my best ascii art skills
		const rootNode = graph[0];
		output.raw('\n');
		printGraph(output, rootNode);
	}

	if (configPath) {
		// Load dev container config
		const buffer = await readLocalFile(configPath);
		if (!buffer) {
			output.write(`Could not load devcontainer.json file from path ${configPath}`, LogLevel.Error);
			process.exit(1);
		}
		//  -- Parse dev container config
		const config: DevContainerConfig = jsonc.parse(buffer.toString());
		const installOrder = await computeDependsOnInstallationOrder(params, config);

		if (!installOrder) {
			output.write(`Could not calculate install order`, LogLevel.Error);
			process.exit(1);
		}

		output.raw('\n');
		for (let i = 0; i < installOrder.length; i++) {
			const { canonicalId, options, id: userId } = installOrder[i];
			const split = canonicalId!.split('@');
			const str = `${split[0]}\n${split[1]}\n${options ? JSON.stringify(options) : ''}\n(Resolved from: '${userId}')`;
			const box = encloseStringInBox(str);
			output.raw(`${box}\n`, LogLevel.Info);
		}
	}

	await dispose();
	process.exit(0);
}

function encloseStringInBox(str: string, indent: number = 0) {
	const lines = str.split('\n');
	lines[0] = `\u001b[1m${lines[0]}\u001b[22m`; // Bold
	const maxWidth = Math.max(...lines.map(l => l.length));
	const box = [
		'┌' + '─'.repeat(maxWidth) + '┐',
		...lines.map(l => '│' + l.padEnd(maxWidth + (l.includes('\u001b[1m') ? 9 : 0)) + '│'),
		'└' + '─'.repeat(maxWidth) + '┘',
	];
	return box.map(t => `${' '.repeat(indent)}${t}`).join('\n');
}

function printGraph(output: Log, node: FNode, indent = 0) {
	const { canonicalId, dependsOn, options, id: userId } = node;

	const split = canonicalId!.split('@');
	const str = `${split[0]}\n${split[1]}\n${options ? JSON.stringify(options) : ''}\n(Resolved from: '${userId}')`;
	output.raw(`${encloseStringInBox(str, indent)}`, LogLevel.Info);
	output.raw('\n', LogLevel.Info);

	for (let i = 0; i < dependsOn.length; i++) {
		printGraph(output, dependsOn[i], indent + 4);
	}
}


