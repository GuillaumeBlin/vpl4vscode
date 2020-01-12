import * as fs from "fs";
import * as path from 'path';
import * as rm from 'typed-rest-client';
import * as vscode from 'vscode';
import * as dicofr from './dico.fr.json';
import * as dicoen from './dico.en.json';
import { FileSystemProvider } from './fileExplorer';

const config = (process.env.VSCODE_NLS_CONFIG ? JSON.parse(process.env.VSCODE_NLS_CONFIG) : undefined);
var dico: any = dicoen;

if (config && config['locale'] === 'fr') {
	dico = dicofr;
}

interface VPLException {
	exception: string;
	message: string;
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

let opt: IRequestOptions = { allowRetries: true, ignoreSslError: true };
let rest: rm.RestClient = new rm.RestClient('rest-samples', undefined, undefined, opt);

let commandDataProvider: VPLNodeProvider;
var diagnosticCollection = vscode.languages.createDiagnosticCollection();
let _channel: vscode.OutputChannel = vscode.window.createOutputChannel('VPL');
let VPLChannel: vscode.StatusBarItem;
let VPLChannelMessage: vscode.StatusBarItem;

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
		var conf = vscode.workspace.getConfiguration('', currentFolder);
		var httpsAddress: (string | undefined) = conf.get('VPL4VSCode.httpsAddress');
		var wsToken: (string | undefined) = conf.get('VPL4VSCode.wsToken');
		var activityId: (string | undefined) = conf.get('VPL4VSCode.activityId');
		var httpsViewerAddress: (string | undefined) = conf.get('VPL4VSCode.httpsViewerAddress');
		if (httpsAddress && wsToken && activityId && httpsViewerAddress) {
			return { "httpsAddress": httpsAddress, "wsToken": wsToken, "activityId": activityId, "httpsViewerAddress": httpsViewerAddress };
		}
	}
	vscode.window.showErrorMessage(dico["global.error.configuration"]);
	return undefined;
}

async function setAccessInfo(text: string, folder: vscode.Uri) {
	currentFolder = folder;

	var conf = vscode.workspace.getConfiguration('', currentFolder);
	await conf.update("files.exclude", { ".vscode": true }, vscode.ConfigurationTarget.WorkspaceFolder);
	await conf.update('VPL4VSCode.httpsAddress', "https://moodle1.u-bordeaux.fr/mod/vpl/webservice.php?moodlewsrestformat=json&", vscode.ConfigurationTarget.WorkspaceFolder);
	await conf.update('VPL4VSCode.wsToken', text.split("&")[1].split("=")[1], vscode.ConfigurationTarget.WorkspaceFolder);
	await conf.update('VPL4VSCode.activityId', text.split("&")[2].split("=")[1], vscode.ConfigurationTarget.WorkspaceFolder);
	await conf.update('VPL4VSCode.httpsViewerAddress', 'https://moodle1.u-bordeaux.fr/mod/vpl/view.php?id=' + text.split("&")[2].split("=")[1], vscode.ConfigurationTarget.WorkspaceFolder);
	vscode.workspace.getConfiguration('').inspect('VPL4VSCode');
	return { "httpsAddress": "https://moodle1.u-bordeaux.fr/mod/vpl/webservice.php?moodlewsrestformat=json&", "wsToken": text.split("&")[1].split("=")[1], "activityId": text.split("&")[2].split("=")[1] };
}

async function setProjectFolder(url: string) {
	var folders = vscode.workspace.workspaceFolders;
	var value, folder: vscode.Uri, infos = undefined;

	if (folders && folders.length > 0) {
		value = await vscode.window.showQuickPick([dico["setProjectFolder.current"], dico["setProjectFolder.choice"]], { placeHolder: dico["setProjectFolder.dest"] });
	} else {

		value = dico["setProjectFolder.choice"];
	}
	if (value === undefined) {
		return;
	}
	var wfolder: vscode.WorkspaceFolder | undefined;
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
			vscode.workspace.onDidChangeWorkspaceFolders(e => {
				wfolder = vscode.workspace.getWorkspaceFolder(folder);
				if (wfolder) {
					setAccessInfo(url, wfolder.uri).then(infos => {
						getOriginalFiles(false, infos);
					});

				}
			});
			await vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, 0, { uri: folder });

		}
	} else {
		wfolder = await vscode.window.showWorkspaceFolderPick();
		if (wfolder) {
			infos = await setAccessInfo(url, wfolder.uri);
			getOriginalFiles(false, infos);
		}
		/*if (f) {
			await vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, 0, { uri: f.uri });
			folder = f.uri;
			infos = await setAccessInfo(url, folder);
			getOriginalFiles(false, infos);
			//await vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0, 0, { uri: f.uri });
		}*/
	}

}


async function getFilesInfo(wsfunction: string, infos: any = undefined) {
	try {
		if (infos === undefined) {
			infos = await getAccessInfo();
		}
		if (infos) {
			let res: rm.IRestResponse<BRaw> = await rest.get<BRaw>(infos.httpsAddress + "wstoken=" + infos.wsToken + "&id=" + infos.activityId + "&wsfunction=" + wsfunction);
			if (res.result) {
				if (res.result.intro) {
					if (currentFolder) {

						await vscode.workspace.getConfiguration('', currentFolder).update('VPL4VSCode.intro', res.result.intro, vscode.ConfigurationTarget.WorkspaceFolder);
					}
				}
				if (res.result.reqfiles) {
					return res.result.reqfiles;
				}
				if (res.result.files) {
					return res.result.files;
				}
				if (res.result.errorcode) {
					//var t = vscode.window.showErrorMessage(dico["global.error.reachability"] + " " + res.result.message, dico["global.reconnect"]);
					commandDataProvider.refresh(2);
					commandDataProvider.setLog(dico["extension.vpl.renew_token"], dico["global.error.reachability"] + " " + res.result.message);
					/*t.then((value) => {
						if (!value) {
							return;
						}
						vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(infos.httpsViewerAddress));
						return;
					}, () => vscode.window.showErrorMessage(dico["global.error.resetting"] + ' ${err}'));*/

				}
			}

		}
	} catch (err) {
		vscode.window.showErrorMessage(dico["global.error.reachability"] + " " + dico["global.error.connectivity"]);
		commandDataProvider.refresh(2);
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
	var regex_complement = /^\s+(.*)$/;
	var editor = vscode.window.activeTextEditor;
	var folder: string;
	if (editor) {
		folder = path.dirname(editor.document.uri.fsPath);
	} else {
		return;
	}
	diagnosticCollection.clear();
	let diagnostics: Map<string, vscode.Diagnostic[]> = new Map<string, vscode.Diagnostic[]>();
	let severity: number | undefined = undefined;
	let message: string | undefined = undefined;
	let range: vscode.Range | undefined = undefined;
	let file: string | undefined = undefined;
	text.split("\n").forEach(element => {
		var match = regex_message.exec(element.trimRight());
		if (match) {
			if (range && message) {
				let diagnostic = new vscode.Diagnostic(range, message, severity);
				file = undefined;
				var t = diagnostics.get(match[1]);
				if (t) {
					t.push(diagnostic);
				} else {
					diagnostics.set(match[1], [diagnostic]);
				}
			}
			severity = (match[4] === "warning" ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
			message = match[5];
			range = new vscode.Range(+match[2] - 1, +match[3], +match[2] - 1, +match[3]);
			file = match[1];
		}
		else {
			if (regex_complement.exec(element.trimRight())) {
				message += '\n' + element;
			}
		}
	});
	if (range && message && file) {
		let diagnostic = new vscode.Diagnostic(range, message, severity);
		var t = diagnostics.get(file);
		if (t) {
			t.push(diagnostic);
		} else {
			diagnostics.set(file, [diagnostic]);
		}
	}
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
				getOutputChannel().clear();
				createCompilationReport("" + res.result.compilation);
				getOutputChannel().appendLine("Evaluation:\n" + res.result.evaluation);
				commandDataProvider.setDescription(dico["extension.vpl.evaluate"], '' + res.result.grade);
				//VPLChannel.text = '[ $(bookmark) VPL - ' + res.result.grade + ' ]';

				getOutputChannel().show(true);
			}
		} catch (err) {
			vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + dico["global.error.connectivity"]);
			commandDataProvider.refresh(2);
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

function readFiles(folder: vscode.Uri, files: VPLFile[]) {
	var infos = '';
	var i: number = 0;
	files.forEach(element => {
		infos = infos + "&files[" + i + "][name]=" + encodeHTML(element.name) + "&files[" + i + "][data]=";
		var content = fs.readFileSync(folder.fsPath + '/' + element.name, 'utf8');
		infos = infos + encodeHTML(content);
		i++;
	});
	return infos;

}

async function saveUserFiles() {
	var infos = await getAccessInfo();
	if (infos) {
		let files: (VPLFile[] | undefined) = await getOriginalFilesInfo();
		if (files) {
			var editor = vscode.window.activeTextEditor;
			if (editor) {
				let folder = vscode.Uri.file(path.dirname(editor.document.uri.fsPath));
				if (checkRequiredFilesArePresent(folder, files)) {
					try {
						var filedata = readFiles(vscode.Uri.file(path.dirname(editor.document.uri.fsPath)), files);
						var res = await rest.client.post(infos.httpsAddress + "wstoken=" + infos.wsToken + "&id=" + infos.activityId + '&wsfunction=mod_vpl_save' + filedata, "");
						let body: VPLException = JSON.parse(await res.readBody());
						if (body) {
							if (body.exception) {
								vscode.window.showErrorMessage(body.message);
								return false;
							}
						}
						if (checkFilesAreCorrectlySaved(folder)) {
							//VPLChannelMessage.text = "[ $(save) VPL - " + dico["saveUserFiles.filesaved"] + " ]";
							commandDataProvider.setDescription(dico["extension.vpl.save"], dico["saveUserFiles.filesaved"]);
							setTimeout(() => {
								commandDataProvider.setDescription(dico["extension.vpl.save"], '');
							}, 2000);
							return true;
						}
					} catch (err) {
						vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + dico["global.error.connectivity"]);
						commandDataProvider.refresh(2);
					}
				}
			}
		}
	}
	return false;
}


async function evaluateUserFiles() {
	commandDataProvider.setDescription(dico["extension.vpl.evaluate"], dico["global.ws.processing"]);
	let done: boolean = await saveUserFiles();
	if (done) {

		var infos = await getAccessInfo();
		if (infos) {
			try {
				let res: rm.IRestResponse<EvaluateRaw> = await rest.get<EvaluateRaw>(infos.httpsAddress + "wstoken=" + infos.wsToken + "&id=" + infos.activityId + '&wsfunction=mod_vpl_evaluate');
				if (res.result) {
					if (res.result.exception) {
						vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + res.result.message);
						return;
					}

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
								commandDataProvider.setDescription(dico["extension.vpl.evaluate"], dico["global.ws.connecting"]);
							});
							ws.on('message', function incoming(data: string) {
								commandDataProvider.setDescription(dico["extension.vpl.evaluate"], data.substr(data.indexOf(":") + 1));
								if (data === "retrieve:") {
									display();
									commandDataProvider.setDescription(dico["extension.vpl.evaluate"], dico["global.ws.done"]);
									resolve();
								}
							});
						});
					}
					/*
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
					});*/

				} else {
					vscode.window.showErrorMessage(dico["global.ws.evaluation.error"]);
				}
			} catch (err) {
				vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + dico["global.error.connectivity"]);
				commandDataProvider.refresh(2);
			}
		}
	}
}


async function runUserFiles(debug = false) {
	let done: boolean = await saveUserFiles();
	if (done) {
		var infos = await getAccessInfo();
		if (infos) {
			try {
				commandDataProvider.setDescription(dico["extension.vpl.run"], dico["global.ws.processing"]);
				let res: rm.IRestResponse<EvaluateRaw> = await rest.get<EvaluateRaw>(infos.httpsAddress + "wstoken=" + infos.wsToken + "&id=" + infos.activityId + '&wsfunction=' + (debug ? 'mod_vpl_debug' : 'mod_vpl_run'));
				if (res.result) {
					if (res.result.exception) {
						vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + res.result.message + '\n');
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
								commandDataProvider.setDescription(dico["extension.vpl.run"], '');
								resolve();
							});

							ws.on('open', function open() {
								commandDataProvider.setDescription(dico["extension.vpl.run"], dico["global.ws.connecting"]);
							});
							ws.on('message', async function incoming(data: string) {
								var d = data.replace("message:", "");
								//console.log(data);
								if (data.startsWith("compilation:")) {
									createCompilationReport("" + data.substr(12));
								}
								commandDataProvider.setDescription(dico["extension.vpl.run"], d.charAt(0).toUpperCase() + d.slice(1));
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
										commandDataProvider.setDescription(dico["extension.vpl.run"], '');
										ws.close();
										resolve();
									});

									wse.on('open', function open() {
										commandDataProvider.setDescription(dico["extension.vpl.run"], dico["global.ws.connecting"]);
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
				commandDataProvider.refresh(2);
			}
		}
	}
}



export async function activate(context: vscode.ExtensionContext) {

	vscode.commands.registerCommand('fileExplorer.openFile', (resource) => vscode.window.showTextDocument(resource));

	const treeDataProvider = new FileSystemProvider(undefined);
	commandDataProvider = new VPLNodeProvider(context);

	vscode.window.onDidChangeActiveTextEditor((textEditor) => {
		if (!textEditor) {
			return;
		}
		var worksp = vscode.workspace.getWorkspaceFolder(textEditor.document.uri);
		if (worksp) {
			treeDataProvider.refresh(worksp);
			var conf = vscode.workspace.getConfiguration('', worksp.uri);
			if (conf.get("VPL4VSCode.wsToken", vscode.ConfigurationTarget.WorkspaceFolder)) {
				currentFolder = worksp.uri;
				getAccessInfo().then(infos => {
					getOriginalFilesInfo(infos).then(tokenValid => {
						if (tokenValid) {
							commandDataProvider.refresh(1);
						} else {
							commandDataProvider.refresh(2);
						}
					}, err => {
						var t = err;
					});

				}, err => {
					var t = err;
				});
			} else {
				commandDataProvider.refresh();
			}
		}
	});
	vscode.window.registerTreeDataProvider("vpl-commands", commandDataProvider);

	vscode.window.createTreeView("vpl-explorer", { treeDataProvider });

	let disposable = vscode.commands.registerCommand('extension.vpl_show_description', async () => {
		CatCodingPanel.createOrShow(context.extensionPath);
	});

	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('extension.vpl_open', async () => {
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
			commandDataProvider.refresh(3);
			var editor = vscode.window.activeTextEditor;
			var uri;
			if (editor) {
				uri = editor.document.uri;
				var folder: string = uri.fsPath;
				if (uri.scheme === "file") {
					folder = path.dirname(uri.fsPath);
				}
				await setAccessInfo(url, vscode.Uri.file(folder));
				commandDataProvider.setDescription(dico["extension.vpl.renew_token"], dico["extension.vpl_renewtoken.info"]);
				setTimeout(() => {
					commandDataProvider.setDescription(dico["extension.vpl.renew_token"], '');
					commandDataProvider.refresh(1);
				}, 2000);
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
			if (currentFolder) {
				fs.readdir(currentFolder.fsPath, (err, files) => {
					if (err) { throw err; }

					for (const file of files) {
						if (currentFolder && file !== ".vscode") {
							fs.unlinkSync(path.join(currentFolder.fsPath, file));
						}
					}
				});
			}
			treeDataProvider.refresh();
			getOriginalFiles();
			treeDataProvider.refresh();
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

	disposable = vscode.commands.registerCommand('extension.vpl_show_report', async () => {
		_channel.show();
	});

	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('extension.vpl_show_output', async () => {
		VPLShell.show();
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



class VPLNodeProvider implements vscode.TreeDataProvider<TreeItem> {
	data: TreeItem[];
	menus: TreeItem[][];
	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;


	constructor(private context: vscode.ExtensionContext) {
		this.data = [new TreeItem(this.context, 'Open', {
			command: 'extension.vpl_open',
			title: ''
		}, 'paperclip-solid')];
		this.menus = [[
			new TreeItem(this.context, dico["extension.vpl.open"], {
				command: 'extension.vpl_open',
				title: ''
			}, 'paperclip-solid')
		],
		[
			new TreeItem(this.context, dico["extension.vpl.open"], {
				command: 'extension.vpl_open',
				title: ''
			}, 'paperclip-solid'),
			new TreeItem(this.context, dico["extension.vpl.description"], {
				command: 'extension.vpl_show_description',
				title: ''
			}, 'info-circle-solid'),
			new TreeItem(this.context, dico["extension.vpl.run"], {
				command: 'extension.vpl_run',
				title: ''
			}, 'rocket-solid', [new TreeItem(this.context, dico["extension.vpl.show_output"], {
				command: 'extension.vpl_show_output',
				title: ''
			}, 'eye-solid')]),
			new TreeItem(this.context, dico["extension.vpl.debug"], {
				command: 'extension.vpl_debug',
				title: ''
			}, 'bug-solid'),
			new TreeItem(this.context, dico["extension.vpl.evaluate"], {
				command: 'extension.vpl_evaluate',
				title: ''
			}, 'check-square-solid', [new TreeItem(this.context, dico["extension.vpl.show_report"], {
				command: 'extension.vpl_show_report',
				title: ''
			}, 'eye-solid')]),
			new TreeItem(this.context, dico["extension.vpl.reset_files"], {
				command: 'extension.vpl_reset',
				title: ''
			}, 'sync-alt-solid'),
			new TreeItem(this.context, dico["extension.vpl.load"], {
				command: 'extension.vpl_load',
				title: ''
			}, 'download-solid'),
			new TreeItem(this.context, dico["extension.vpl.save"], {
				command: 'extension.vpl_save',
				title: ''
			}, 'upload-solid')
		],
		[
			new TreeItem(this.context, dico["extension.vpl.open"], {
				command: 'extension.vpl_open',
				title: ''
			}, 'paperclip-solid'),
			new TreeItem(this.context, dico["extension.vpl.renew_token"], {
				command: 'extension.vpl_renewtoken',
				title: ''
			}, 'fingerprint-solid', [new TreeItem(this.context, '', {
				command: '',
				title: ''
			}, 'info-circle-solid'),
			new TreeItem(this.context, dico["extension.vpl.renew_token_url"], {
				command: 'vscode.open',
				title: ''
			}, 'link-solid')]
			)
		],
		[
			new TreeItem(this.context, dico["extension.vpl.open"], {
				command: 'extension.vpl_open',
				title: ''
			}, 'paperclip-solid'),
			new TreeItem(this.context, dico["extension.vpl.renew_token"], {
				command: 'extension.vpl_renewtoken',
				title: ''
			}, 'fingerprint-solid'
			)
		]
		];
	}

	setDescription(element: string, description: string) {
		this.data.forEach(e => {
			if (e.label === element) {
				e.description = description;
			}
		}
		);
		this._onDidChangeTreeData.fire();
	}

	setLog(element: string, log: string) {

		this.data.forEach(e => {
			if (e.label === element) {
				e.getChildren()[0].label = log;
			}
		});
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
		return element;
	}

	getChildren(element?: TreeItem | undefined): vscode.ProviderResult<TreeItem[]> {
		if (element === undefined) {
			return this.data;
		}
		return element.children;
		//return null;
	}

	refresh(state: number = 0) {
		this.data = this.menus[state];
		if (state === 2) {
			var uri: string = vscode.workspace.getConfiguration('', currentFolder).get('VPL4VSCode.httpsViewerAddress') || '';
			this.data.forEach(e => {
				if (e.label === dico["extension.vpl.renew_token"]) {
					e.children.forEach(f => {
						if (f.label === dico["extension.vpl.renew_token_url"]) {
							if (f.command) {
								f.command.arguments = [vscode.Uri.parse(uri)];
							}
						}
					});
				}
			});
		}
		this._onDidChangeTreeData.fire();
	}
}

class TreeItem extends vscode.TreeItem {
	children: TreeItem[] = [];
	constructor(private context: vscode.ExtensionContext, label: string, command: vscode.Command, icon: string, child: TreeItem[] | undefined = undefined) {
		super(
			label, (child ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None));
		//this.collapsibleState = vscode.TreeItemCollapsibleState.None;
		this.command = command;
		this.iconPath = {
			dark: this.context.asAbsolutePath(path.join('resources', icon + '-dark.svg')),
			light: this.context.asAbsolutePath(path.join('resources', icon + '-light.svg'))
		};
		if (child) {
			child.forEach(e => { this.children.push(e); });
		}

	}
	getChildren() {
		return this.children;
	}
}


const cats = {
	'Coding Cat': 'https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif',
	'Compiling Cat': 'https://media.giphy.com/media/mlvseq9yvZhba/giphy.gif',
	'Testing Cat': 'https://media.giphy.com/media/3oriO0OEd9QIDdllqo/giphy.gif'
};


/**
 * Manages cat coding webview panels
 */
class CatCodingPanel {
	/**
	 * Track the currently panel. Only allow a single panel to exist at a time.
	 */
	public static currentPanel: CatCodingPanel | undefined;

	public static readonly viewType = 'catCoding';

	private readonly _panel: vscode.WebviewPanel;
	private readonly _extensionPath: string;
	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(extensionPath: string) {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If we already have a panel, show it.
		if (CatCodingPanel.currentPanel) {
			CatCodingPanel.currentPanel._panel.reveal(column);
			return;
		}

		// Otherwise, create a new panel.
		const panel = vscode.window.createWebviewPanel(
			CatCodingPanel.viewType,
			'Cat Coding',
			column || vscode.ViewColumn.One,
			{
				// Enable javascript in the webview
				enableScripts: true,

				// And restrict the webview to only loading content from our extension's `media` directory.
				localResourceRoots: [vscode.Uri.file(path.join(extensionPath, 'media'))]
			}
		);

		CatCodingPanel.currentPanel = new CatCodingPanel(panel, extensionPath);
	}

	public static revive(panel: vscode.WebviewPanel, extensionPath: string) {
		CatCodingPanel.currentPanel = new CatCodingPanel(panel, extensionPath);
	}

	private constructor(panel: vscode.WebviewPanel, extensionPath: string) {
		this._panel = panel;
		this._extensionPath = extensionPath;

		// Set the webview's initial html content
		this._update();

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

		// Update the content based on view changes
		this._panel.onDidChangeViewState(
			e => {
				if (this._panel.visible) {
					this._update();
				}
			},
			null,
			this._disposables
		);

		// Handle messages from the webview
		this._panel.webview.onDidReceiveMessage(
			message => {
				switch (message.command) {
					case 'alert':
						vscode.window.showErrorMessage(message.text);
						return;
				}
			},
			null,
			this._disposables
		);
	}

	public doRefactor() {
		// Send a message to the webview webview.
		// You can send any JSON serializable data.
		this._panel.webview.postMessage({ command: 'refactor' });
	}

	public dispose() {
		CatCodingPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	private _update() {
		const webview = this._panel.webview;

		// Vary the webview's content based on where it is located in the editor.
		switch (this._panel.viewColumn) {
			case vscode.ViewColumn.Two:
				this._updateForCat(webview, 'Compiling Cat');
				return;

			case vscode.ViewColumn.Three:
				this._updateForCat(webview, 'Testing Cat');
				return;

			case vscode.ViewColumn.One:
			default:
				this._updateForCat(webview, 'Coding Cat');
				return;
		}
	}

	private _updateForCat(webview: vscode.Webview, catName: keyof typeof cats) {
		this._panel.title = catName;
		this._panel.webview.html = this._getHtmlForWebview(webview, cats[catName]);
	}

	private _getHtmlForWebview(webview: vscode.Webview, catGifPath: string) {
		// Local path to main script run in the webview
		const scriptPathOnDisk = vscode.Uri.file(
			path.join(this._extensionPath, 'media', 'main.js')
		);

		// And the uri we use to load this script in the webview


		return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Cat Coding</title>
            </head>
            <body>
                <img src="${catGifPath}" width="300" />
                <h1 id="lines-of-code-counter">0</h1>
            </body>
            </html>`;
	}
}

function getNonce() {
	let text = '';
	const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	for (let i = 0; i < 32; i++) {
		text += possible.charAt(Math.floor(Math.random() * possible.length));
	}
	return text;
}
