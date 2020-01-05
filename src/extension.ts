import * as fs from "fs";
import * as path from 'path';
import * as rm from 'typed-rest-client';
import * as vscode from 'vscode';
import * as dicofr from './dico.fr.json';
import * as dicoen from './dico.en.json';

const config = (process.env.VSCODE_NLS_CONFIG ? JSON.parse(process.env.VSCODE_NLS_CONFIG) : undefined);
var dico: any = dicoen;

if (config && config['locale'] === 'fr') {
	dico = dicofr;
}

interface VPLFile {
	name: string;
	data: string;
}

interface BRaw {
	example: boolean;
	intro: string;
	introformat: string;
	maxfiles: number;
	name: string;
	reqfiles: Array<VPLFile>;
	reqpassword: boolean;
	restrictededitor: boolean;
	shortdescription: string;
	compilation: string;
	evaluation: string;
	files: Array<VPLFile>;
	grade: number;
	message: string;
	errorcode: string;
}



interface EvaluateRaw {
	monitorURL: string;
	executeURL: string;
	exception: string;
	message: string;
}

interface ResEvaluateRaw {
	compilation: string;
	evaluation: string;
	grade: number;
}

interface IHeaders {
	[key: string]: any;
}

interface IProxyConfiguration {
	proxyUrl: string;
	proxyUsername?: string;
	proxyPassword?: string;
	proxyBypassHosts?: string[];
}

interface ICertConfiguration {
	caFile?: string;
	certFile?: string;
	keyFile?: string;
	passphrase?: string;
}

interface IRequestOptions {
	headers?: IHeaders;
	socketTimeout?: number;
	ignoreSslError?: boolean;
	proxy?: IProxyConfiguration;
	cert?: ICertConfiguration;
	allowRedirects?: boolean;
	maxRedirects?: number;
	maxSockets?: number;
	keepAlive?: boolean;
	presignedUrlPatterns?: RegExp[];
	// Allows retries only on Read operations (since writes may not be idempotent)
	allowRetries?: boolean;
	maxRetries?: number;
}

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

let server: string = "";
let opt: IRequestOptions = { allowRetries: true, ignoreSslError: true };
let rest: rm.RestClient = new rm.RestClient('rest-samples', undefined, undefined, opt);

var diagnosticCollection = vscode.languages.createDiagnosticCollection();
let _channel: vscode.OutputChannel = vscode.window.createOutputChannel('VPL');
let VPLChannel: vscode.StatusBarItem;
let VPLChannelMessage: vscode.StatusBarItem;

let extensionPath: string;
let currentFolder: (vscode.Uri | undefined);
let VPLShell: vscode.Terminal;

function getOutputChannel(): vscode.OutputChannel {
	return _channel;
}

function setCurrentFolder() {
	var editor = vscode.window.activeTextEditor;
	var uri;
	if (editor) {
		uri = editor.document.uri;
		var folder: string = uri.fsPath;
		if (uri.scheme === "file") {
			folder = path.dirname(uri.fsPath);
		}
		currentFolder = vscode.Uri.file(folder);
	}
}

function encodeHTML(str: string) {
	str = encodeURI(str).replace(/#/gi, '%23');
	str = str.replace(/\+/gi, '%2B');
	str = str.replace(/\&/gi, '%26');
	return str;
	/*var entities = ['%21', '%2A', '%27', '%28', '%29', '%3B', '%3A', '%40', '%26', '%3D', '%2B', '%24', '%2C', '%2F', '%3F', '%25', '%23', '%5B', '%5D'];
	var replacements = ['!', '*', "'", "(", ")", ";", ":", "@", "&", "=", "+", "$", ",", "/", "?", "%", "#", "[", "]"];*/
}

async function getAccessInfo() {
	if (currentFolder) {
		var httpsAddress: (string | undefined) = vscode.workspace.getConfiguration('', currentFolder).get('VPL4VSCode.httpsAddress');
		var wsToken: (string | undefined) = vscode.workspace.getConfiguration('', currentFolder).get('VPL4VSCode.wsToken');
		var activityId: (string | undefined) = vscode.workspace.getConfiguration('', currentFolder).get('VPL4VSCode.activityId');
		if (httpsAddress && wsToken && activityId) {
			return { "httpsAddress": httpsAddress, "wsToken": wsToken, "activityId": activityId };
		}
	}
	vscode.window.showErrorMessage(dico["global.error.configuration"]);
	return undefined;
}

async function setAccessInfo(text: string, folder: vscode.Uri) {
	currentFolder = folder;
	var content = "{\n";
	content += '"files.exclude": {\n';
	content += '	".vscode": true\n';
	content += '},\n';
	content += '"VPL4VSCode.activityId": ' + text.split("&")[2].split("=")[1] + ',\n';
	content += '"VPL4VSCode.wsToken": "' + text.split("&")[1].split("=")[1] + '",\n';
	content += '"VPL4VSCode.currentFolder": "' + folder.fsPath + '",\n';
	content += '"VPL4VSCode.httpsAddress":"https://moodle1.u-bordeaux.fr/mod/vpl/webservice.php?moodlewsrestformat=json&"\n}';
	if (!fs.existsSync(folder.fsPath + '/.vscode')) {
		await fs.mkdirSync(folder.fsPath + '/.vscode');
	}
	await fs.writeFileSync(folder.fsPath + '/.vscode/settings.json', content, { encoding: 'utf8', flag: 'w' });
	return { "httpsAddress": "https://moodle1.u-bordeaux.fr/mod/vpl/webservice.php?moodlewsrestformat=json&", "wsToken": text.split("&")[1].split("=")[1], "activityId": text.split("&")[2].split("=")[1] };
}

async function setProjectFolder(url: string) {
	var folders = vscode.workspace.workspaceFolders;
	var value, folder = undefined, infos = undefined;

	if (folders && folders.length > 0) {
		value = await vscode.window.showQuickPick([dico["setProjectFolder.current"], dico["setProjectFolder.choice"]], { placeHolder: dico["setProjectFolder.dest"] });
	} else {

		value = dico["setProjectFolder.choice"];
	}
	if (value === undefined) {
		return;
	}
	if (value === dico["setProjectFolder.choice"]) {
		const options: vscode.OpenDialogOptions = {
			canSelectMany: false,
			openLabel: 'Open',
			canSelectFolders: true,
			canSelectFiles: false
		};
		const f = await vscode.window.showOpenDialog(options);
		if (f) {
			folder = f[0];
			infos = await setAccessInfo(url, folder);
			getOriginalFiles(false, infos);
			await vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, 0, { uri: folder });
		}
	} else {
		const f = await vscode.window.showWorkspaceFolderPick();
		if (f) {
			folder = f.uri;
			infos = await setAccessInfo(url, folder);
			getOriginalFiles(false, infos);
			await vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, 0, { uri: f.uri });
		}
	}
}

async function getFilesInfo(wsfunction: string, infos: any = undefined) {
	try {
		if (infos === undefined) {
			infos = await getAccessInfo();
		}
		if (infos) {
			let res: rm.IRestResponse<BRaw> = await rest.get<BRaw>(infos.httpsAddress + "wstoken=" + infos.wsToken + "&id=" + infos.activityId + "&wsfunction=" + wsfunction);
			console.log(res);
			if (res.result) {
				if (res.result.reqfiles) {
					return res.result.reqfiles;
				}
				if (res.result.files) {
					return res.result.files;
				}
				if (res.result.errorcode) {
					vscode.window.showErrorMessage(dico["global.error.reachability"] + " " + res.result.message);
				}
			}

		}
	} catch (err) {
		vscode.window.showErrorMessage(dico["global.error.reachability"] + " " + dico["global.error.connectivity"]);
	}

	return;
}

async function getOriginalFilesInfo(infos: any = undefined) {
	return await getFilesInfo('mod_vpl_info', infos);
}

async function getUserCurrentFilesInfo(infos: any = undefined) {
	return await getFilesInfo('mod_vpl_open', infos);
}

function checkRequiredFilesArePresent(folder: vscode.Uri, files: VPLFile[]) {
	files.forEach(element => {
		if (!fs.existsSync(folder.fsPath + '/' + element.name)) {
			vscode.window.showErrorMessage(element.name + dico["global.error.filenotfound"]);
			return false;
		}
	});
	return true;
}

async function checkFilesAreCorrectlySaved(folder: vscode.Uri) {
	let files: (VPLFile[] | undefined) = await getUserCurrentFilesInfo();
	if (!files) {
		return false;
	}
	files.forEach(element => {
		if (fs.existsSync(folder.fsPath + '/' + element.name)) {
			var content = fs.readFileSync(folder.fsPath + '/' + element.name, 'utf8');
			if (content !== element.data) {
				vscode.window.showErrorMessage(element.name + dico["global.error.filenotsaved"]);
				return false;
			}
		} else {
			return false;
		}
	});
	return true;
}


function writeFiles(folder: vscode.Uri, files: VPLFile[]) {
	files.forEach(element => {
		var ext = path.extname(element.name);
		var fileext = '|gif|jpg|jpeg|png|ico|mp4|zip|jar|pdf|tar|bin|7z|arj|deb|gzip|rar|rpm|dat|db|rtf|doc|docx|odt|';
		var enc = 'utf8';
		if (fileext.indexOf('|' + ext.substr(1) + '|') > 0) {
			enc = 'base64';
		}
		fs.writeFileSync(folder.fsPath + '/' + element.name, element.data, { encoding: enc, flag: 'w' });
		var res = vscode.workspace.findFiles(element.name, '', 1);
		res.then((URI) => {
			if (!URI) {
				return;
			}
			vscode.commands.executeCommand('workbench.action.files.revert', URI);
			return;
		}, () => vscode.window.showErrorMessage(dico["global.error.filewritting"] + ' ${err}'));
	});
}

async function createCompilationReport(text: string) {
	var regex_message = /^(.*):(\d+):(\d+):\s+(warning|error):\s+(.*)$/;
	var editor = vscode.window.activeTextEditor;
	var folder: string;
	if (editor) {
		folder = path.dirname(editor.document.uri.fsPath);
	} else {
		return;
	}
	diagnosticCollection.clear();
	let diagnostics: Map<string, vscode.Diagnostic[]> = new Map<string, vscode.Diagnostic[]>();
	text.split("\n").forEach(element => {
		var match = regex_message.exec(element.trimRight());
		if (match) {
			let severity = (match[4] === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
			let message = match[5];
			let range = new vscode.Range(+match[2] - 1, +match[3], +match[2] - 1, +match[3]);
			let diagnostic = new vscode.Diagnostic(range, message, severity);
			var t = diagnostics.get(match[1]);
			if (t) {
				t.push(diagnostic);
			} else {
				diagnostics.set(match[1], [diagnostic]);
			}

		}
	});
	diagnostics.forEach((element, key) => {
		diagnosticCollection.set(vscode.Uri.file(folder + '/' + key), element);
	});
	vscode.commands.executeCommand('workbench.action.problems.focus');
}

async function display() {
	var infos = await getAccessInfo();
	if (infos) {
		try {
			let res: rm.IRestResponse<ResEvaluateRaw> = await rest.get<ResEvaluateRaw>(infos.httpsAddress + "wstoken=" + infos.wsToken + "&id=" + infos.activityId + "&wsfunction=mod_vpl_get_result");
			if (res.result) {
				createCompilationReport("" + res.result.compilation);
				getOutputChannel().appendLine("Evaluation:\n" + res.result.evaluation);
				VPLChannel.text = '[ $(bookmark) VPL - ' + res.result.grade + ' ]';
				getOutputChannel().show(true);
			}
		} catch (err) {
			vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + dico["global.error.connectivity"]);
		}
	}
}

async function getOriginalFiles(user: boolean = false, infos: any = undefined) {
	let files: (VPLFile[] | undefined);
	if (user) {
		files = await getUserCurrentFilesInfo(infos);
	} else {
		files = await getOriginalFilesInfo(infos);
	}
	if (files) {
		if (currentFolder) {
			writeFiles(currentFolder, files);
			vscode.window.showTextDocument(vscode.Uri.file(currentFolder.fsPath + '/' + files[0].name));
		}
	}
}

async function getUserCurrentFiles() {
	getOriginalFiles(true);
}

async function saveUserFiles() {
	var infos = await getAccessInfo();
	if (infos) {
		let files: (VPLFile[] | undefined) = await getUserCurrentFilesInfo();
		if (files) {
			var editor = vscode.window.activeTextEditor;
			if (editor) {
				let folder = vscode.Uri.file(path.dirname(editor.document.uri.fsPath));
				if (checkRequiredFilesArePresent(folder, files)) {
					try {
						if (checkFilesAreCorrectlySaved(folder)) {
							VPLChannelMessage.text = "[ $(save) VPL - " + dico["saveUserFiles.filesaved"] + " ]";
						}
					} catch (err) {
						vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + dico["global.error.connectivity"]);
					}
				}
			}
		}
	}
}


async function evaluateUserFiles() {
	await saveUserFiles();
	var infos = await getAccessInfo();
	if (infos) {
		try {
			let res: rm.IRestResponse<EvaluateRaw> = await rest.get<EvaluateRaw>(infos.httpsAddress + "wstoken=" + infos.wsToken + "&id=" + infos.activityId + '&wsfunction=mod_vpl_evaluate');
			if (res.result) {
				if (res.result.exception) {
					vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + res.result.message);
					return;
				}
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: "Processing ...",
					cancellable: true
				}, async (progress, ctoken) => {
					ctoken.onCancellationRequested(() => {
					});
					if (res.result) {
						return new Promise((resolve) => {
							const WebSocket = require('ws');
							if (res.result === null) {
								resolve();
								return;
							}
							var URL = res.result.monitorURL;
							const ws = new WebSocket(URL);
							ws.on('error', function incoming() {
								vscode.window.showErrorMessage(dico["global.ws.reachability"] + URL);
							});
							ws.on('close', function open() {
								resolve();
							});
							ws.on('open', function open() {
								progress.report({ message: dico["global.ws.connecting"] });
							});
							ws.on('message', function incoming(data: string) {
								progress.report({ message: data });
								if (data === "retrieve:") {
									display();
									progress.report({ increment: 100, message: dico["global.ws.done"] });
									resolve();
								}
							});
						});
					}
				});

			} else {
				vscode.window.showErrorMessage(dico["global.ws.evaluation.error"]);
			}
		} catch (err) {
			vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + dico["global.error.connectivity"]);
		}
	}
}


async function runUserFiles(debug = false) {
	await saveUserFiles();
	var infos = await getAccessInfo();
	if (infos) {
		try {
			VPLChannelMessage.text = "[ $(rocket) VPLBdx - " + dico["global.ws.processing"] + " ]";
			let res: rm.IRestResponse<EvaluateRaw> = await rest.get<EvaluateRaw>(infos.httpsAddress + "wstoken=" + infos.wsToken + "&id=" + infos.activityId + '&wsfunction=' + (debug ? 'mod_vpl_debug' : 'mod_vpl_run'));
			if (res.result) {
				if (res.result.exception) {
					vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + res.result.message);
					return;
				}
				return new Promise((resolve) => {
					const WebSocket = require('ws');
					if (res.result === null) {
						resolve();
						return;
					} else {
						var URLm = res.result.monitorURL;
						var URLe = res.result.executeURL;
						const ws = new WebSocket(URLm);
						ws.on('error', function incoming() {
							vscode.window.showErrorMessage(dico["global.ws.reachability"] + URLm);
						});

						ws.on('close', function open() {
							VPLChannelMessage.text = '';
							resolve();
						});

						ws.on('open', function open() {
							VPLChannelMessage.text = "[ $(rocket) VPLBdx - " + dico["global.ws.connecting"] + " ]";
						});
						ws.on('message', async function incoming(data: string) {
							var d = data.replace("message:", "");
							console.log(data);
							if (data.startsWith("compilation:")) {
								createCompilationReport("" + data);
							}
							VPLChannelMessage.text = "[ $(rocket) VPLBdx -" + d.charAt(0).toUpperCase() + d.slice(1) + " ]";
							if (data.startsWith("run:vnc")) {
								vscode.commands.executeCommand('extension.liveServer.goOnline');
								var path = URLe.slice(URLe.lastIndexOf("/", URLe.lastIndexOf("/", URLe.lastIndexOf("/") - 1) - 1) + 1);
								var host = URLe.substr(6, URLe.indexOf(path) - 6);
								vscode.env.openExternal(vscode.Uri.parse('http://localhost:33400/vnc_lite.html?host=' + host + '&password=' + data.slice(8) + '&path=' + path));
							}
							if (data === "run:terminal") {
								const wse = new WebSocket(URLe);


								let writeEmitter = new vscode.EventEmitter<string>();
								let pty: any = {
									onDidWrite: writeEmitter.event,
									open: () => writeEmitter.fire('-- ' + dico["runUserFiles.io"] + ' --\r\n\r\n'),
									close: () => { },
									handleInput: (data: string) => {
										wse.send(data);
									}
								};
								if (VPLShell) {
									VPLShell.dispose();
								}
								VPLShell = (<any>vscode.window).createTerminal({ name: `VPL Shell`, pty });
								VPLShell.show();
								vscode.commands.executeCommand('workbench.action.terminal.clear');

								wse.on('error', function incoming() {
									vscode.window.showErrorMessage(dico["global.ws.reachability"] + URLm);
								});

								wse.on('close', function open() {
									VPLChannelMessage.text = '';
									ws.close();
									resolve();
								});

								wse.on('open', function open() {
									VPLChannelMessage.text = "[ $(rocket) VPLBdx - " + dico["global.ws.connecting"] + " ]";
								});

								wse.on('message', function incoming(data: string) {
									writeEmitter.fire(data);
								});
							}
						});
					}

				});
			}

		} catch (err) {
			vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + dico["global.error.connectivity"]);
		}
	}
}



export async function activate(context: vscode.ExtensionContext) {
	extensionPath = context.extensionPath;

	let disposable = vscode.commands.registerCommand('extension.vpl_open', async () => {
		let url = await vscode.env.clipboard.readText();
		if (url.indexOf("wstoken") > -1) {
			await setProjectFolder(url);

		} else {
			vscode.window.showErrorMessage(dico["extension.vpl_open.error"]);
		}
	});

	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('extension.vpl_renewtoken', async () => {
		let url = await vscode.env.clipboard.readText();
		if (url.indexOf("wstoken") > -1) {
			var editor = vscode.window.activeTextEditor;
			var uri;
			if (editor) {
				uri = editor.document.uri;
				var folder: string = uri.fsPath;
				if (uri.scheme === "file") {
					folder = path.dirname(uri.fsPath);
				}
				await setAccessInfo(url, vscode.Uri.file(folder));
				VPLChannelMessage.text = "[ $(key) VPLBdx - " + dico["extension.vpl_renewtoken.info"] + " ]";
			}
		} else {
			vscode.window.showErrorMessage(dico["extension.vpl_open.error"]);
		}
	});

	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('extension.vpl_load', async () => {
		setCurrentFolder();
		await getUserCurrentFiles();
	});

	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand('extension.vpl_reset', async () => {
		var res = vscode.window.showWarningMessage(dico["extension.vpl_reset.warning"], dico["global.yes"], dico["global.no"]);
		res.then((value) => {
			if (!value || value !== dico["global.yes"]) {
				return;
			}
			setCurrentFolder();
			getOriginalFiles();
			return;
		}, () => vscode.window.showErrorMessage(dico["global.error.resetting"] + ' ${err}'));
	});

	context.subscriptions.push(disposable);
	disposable = vscode.commands.registerCommand('extension.vpl_save', async () => {
		VPLChannelMessage.show();
		setCurrentFolder();
		saveUserFiles();

	});


	context.subscriptions.push(disposable);
	disposable = vscode.commands.registerCommand('extension.vpl_evaluate', async () => {
		VPLChannel.show();
		setCurrentFolder();
		evaluateUserFiles();
	});

	context.subscriptions.push(disposable);
	disposable = vscode.commands.registerCommand('extension.vpl_run', async () => {
		VPLChannelMessage.show();
		setCurrentFolder();
		runUserFiles();

	});

	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('extension.vpl_debug', async () => {
		VPLChannelMessage.show();
		setCurrentFolder();
		runUserFiles(true);
	});

	context.subscriptions.push(disposable);

	const myCommandId = 'vpl.seelog';
	context.subscriptions.push(vscode.commands.registerCommand(myCommandId, () => {
		_channel.show(true);
	}));

	VPLChannel = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	VPLChannel.command = myCommandId;

	context.subscriptions.push(VPLChannel);
	VPLChannel.text = '[ $(preview) VPL ]';
	VPLChannel.color = 'black';
	VPLChannel.tooltip = dico["global.output.channel"];

	VPLChannelMessage = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	context.subscriptions.push(VPLChannelMessage);
	VPLChannelMessage.text = '[ $(note) VPL ]';
	VPLChannelMessage.color = '#FFF500';
	VPLChannelMessage.tooltip = dico["global.output.message"];
	/*var t = vscode.window.createTerminal({ name: 'Command', cwd: extensionPath });
	t.sendText("npm start");*/
	vscode.workspace.getConfiguration('liveServer.settings').update("port", 33400, false);
	let ext = vscode.extensions.getExtension("GuillaumeBlin.vpl4vscode");

	if (ext) {
		vscode.workspace.getConfiguration('liveServer.settings').update("root", ext.extensionPath + "/vnc", false);
	}

}

// this method is called when your extension is deactivated
export function deactivate() { }
