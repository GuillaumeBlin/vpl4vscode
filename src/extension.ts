import * as fs from "fs";
import * as path from 'path';
import * as rm from 'typed-rest-client';
import * as vscode from 'vscode';
import * as dicofr from './dico.fr.json';
import * as dicoen from './dico.en.json';
import { FileSystemProvider } from './fileExplorer';
import fetch from "node-fetch";
import * as puppeteer from 'puppeteer';

var web_panel: vscode.WebviewPanel;

function openweb(url: string) {
	web_panel = vscode.window.createWebviewPanel(
		'webPage',
		'VNC',
		vscode.ViewColumn.One,
		{
			enableScripts: true,
			retainContextWhenHidden: true
		}
	);
	const html = `
			<!DOCTYPE html >
			<html lang="en">
			<head>
			<head>
			<style>
			  body, html
				{
				  margin: 0; padding: 0; height: 100%; overflow: hidden;
				}
				.vscode-light {
					background: #fff;
				}
			</style>
		  </head>
		  <body>
			<iframe  class="vscode-light" id= "iframe" width="100%" height="100%" src="${url}" frameborder="0">
			</iframe>
		  </body>
		  </html>
			`;
	web_panel.webview.html = html;
}


const config = (process.env.VSCODE_NLS_CONFIG ? JSON.parse(process.env.VSCODE_NLS_CONFIG) : undefined);
var dico: any = dicoen;
var faq: vscode.Uri, faqFolder: vscode.Uri;
var cookies: string = '';
var currentInfos;
var optget: (IRequestGetOptions | undefined);
var browser: (puppeteer.Browser | undefined);
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

interface IRequestGetOptions {
	acceptHeader?: string;
	additionalHeaders?: IHeaders;
	responseProcessor?: Function;
	deserializeDates?: boolean;
}


process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

let rest: rm.RestClient;// = new rm.RestClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.183 Safari/537.36', undefined, undefined, opt);

let commandDataProvider: VPLNodeProvider;
var diagnosticCollection = vscode.languages.createDiagnosticCollection();
let _channel: vscode.OutputChannel = vscode.window.createOutputChannel('VPL');
let currentFolder: (vscode.Uri | undefined);
let VPLShell: vscode.Terminal;

vscode.workspace.onDidChangeTextDocument(e => {
	diagnosticCollection.delete(e.document.uri);
});

function getOutputChannel(): vscode.OutputChannel {
	return _channel;
}

function setCurrentFolder(folder: vscode.Uri | undefined = undefined) {
	if (folder) {
		currentFolder = folder;
	} else {
		var editor = vscode.window.activeTextEditor;
		var wfolder;
		if (editor) {
			wfolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
			if (wfolder) {

				currentFolder = wfolder.uri;
			}
		}
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



async function getValidToken() {
	if (currentFolder) {
		//RETRIEVE THE VPL ACCESS INFORMATION FROM THE CURRENT FOLDER AND RETURN IT
		var conf = vscode.workspace.getConfiguration('', currentFolder);
		var httpsAddress: (string | undefined) = conf.get('VPL4VSCode.moodleAddress');
		var activityId: (string | undefined) = conf.get('VPL4VSCode.activityId');
		var wsToken: string = '';
		if (httpsAddress && activityId) {
			var resp = await fetch(httpsAddress + '/mod/vpl/views/show_webservice.php?id=' + activityId, { 'headers': { 'cookie': cookies } });
			if (resp.redirected) {
				await getValidCookies();
				resp = await fetch(httpsAddress + '/mod/vpl/views/show_webservice.php?id=' + activityId, { 'headers': { 'cookie': cookies } });
			}
			var t = await resp.text();
			wsToken = t.substring(t.indexOf("wstoken") + 8, t.indexOf("wstoken") + 40);
			if (wsToken) {
				await conf.update('VPL4VSCode.wsToken', wsToken, vscode.ConfigurationTarget.WorkspaceFolder);
				console.log("Valid token obtained - "+wsToken);
				return { "httpsAddress": httpsAddress, "wsToken": wsToken, "activityId": activityId, "httpsViewerAddress": httpsAddress + '/mod/vpl/views/view.php?id=' + activityId };
			}
		}
	}else{
		console.log("no valid token to get");
	}
	return undefined;

}

async function getAccessInfo() {
	if (currentFolder) {
		var conf = vscode.workspace.getConfiguration('', currentFolder);
		var httpsAddress: (string | undefined) = conf.get('VPL4VSCode.moodleAddress');
		var activityId: (string | undefined) = conf.get('VPL4VSCode.activityId');
		var wsToken: (string | undefined) = conf.get('VPL4VSCode.wsToken');
		if (httpsAddress && activityId && wsToken) {
			return { "httpsAddress": httpsAddress, "wsToken": wsToken, "activityId": activityId, "httpsViewerAddress": httpsAddress + '/mod/vpl/views/view.php?id=' + activityId };
		}
		if (!wsToken) {
			return await getValidToken();
		}
	}
	return undefined;
}

async function setAccessInfo(host: string, activityId: string) {
	if (currentFolder) {
		var conf = vscode.workspace.getConfiguration('', currentFolder);
		await conf.update("files.exclude", { ".vscode": true }, vscode.ConfigurationTarget.WorkspaceFolder);
		await conf.update('VPL4VSCode.moodleAddress', host, vscode.ConfigurationTarget.WorkspaceFolder);
		await conf.update('VPL4VSCode.activityId', activityId, vscode.ConfigurationTarget.WorkspaceFolder);
		await conf.update('VPL4VSCode.moodleCookies', cookies, vscode.ConfigurationTarget.WorkspaceFolder);
		vscode.workspace.getConfiguration('').inspect('VPL4VSCode');
		return { "moodleAddress": host, "activityId": activityId };
	}
}


async function openFolder(folder: vscode.Uri) {

	var files: string[] = fs.readdirSync(folder.fsPath);
	for (let file of files) {
		if (file !== ".vscode") {
			var elem = vscode.Uri.file(folder.fsPath + "/" + file);
			await vscode.window.showTextDocument(elem, { preview: false });
		}
	}
}

async function setProjectFolder(host: string, activityId: string) {
	await addDefaultWorkspace();
	var folders = vscode.workspace.workspaceFolders;
	var nbFolders = 0;

	var value, folder: vscode.Uri, infos = undefined;
	if (folders && folders.length > 0) {
		nbFolders = folders.length;
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
			vscode.workspace.onDidChangeWorkspaceFolders(async e => {
				for (const added of e.added) {
					setCurrentFolder(added.uri);
					await setAccessInfo(host, activityId)
					await getOriginalFiles(false, await getAccessInfo());
					await openFolder(added.uri);
				}
			});
			vscode.workspace.updateWorkspaceFolders(nbFolders, 0, { uri: folder });
		}
	} else {
		wfolder = await vscode.window.showWorkspaceFolderPick();
		if (wfolder) {
			setCurrentFolder(wfolder.uri);
			await setAccessInfo(host, activityId)
			await getOriginalFiles(false, await getAccessInfo());
			await openFolder(wfolder.uri);
		}
	}


}


async function getFilesInfo(wsfunction: string, infos: any = undefined) {
	await addDefaultWorkspace();
	var ok: boolean = true;
	if (currentFolder) {
		do {
			infos = await getAccessInfo();
			if (infos) {
				try {
					ok = true;
					let res: rm.IRestResponse<BRaw> = await rest.get<BRaw>(infos.httpsAddress + '/mod/vpl/webservice.php?moodlewsrestformat=json&wstoken=' + infos.wsToken + '&id=' + infos.activityId + '&wsfunction=' + wsfunction, optget);

					if (res.result) {
						if (res.result.intro) {
							await vscode.workspace.getConfiguration('', currentFolder).update('VPL4VSCode.intro', res.result.intro, vscode.ConfigurationTarget.WorkspaceFolder);
						}
						if (res.result.reqfiles) {
							return res.result.reqfiles;
						}
						if (res.result.files) {
							return res.result.files;
						}
						if (res.result.errorcode) {
							//commandDataProvider.refresh(2);
							//commandDataProvider.setLog(dico["extension.vpl.renew_token"], dico["global.error.reachability"] + " " + res.result.message);
							ok = false;
							infos = await getAccessInfo();
						}
					}
				} catch (err) {
					vscode.window.showErrorMessage(dico["global.error.reachability"] + " " + dico["global.error.connectivity"]);
					commandDataProvider.refresh(2);
				}
			}
		} while (!ok);
	}
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
	var noSevereError = true;
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
			if (severity === vscode.DiagnosticSeverity.Error) {
				noSevereError = false;
			}
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
	return noSevereError;
}

async function display() {
	var ok: boolean = true;
	do {
		var infos = await getAccessInfo();
		if (infos) {
			try {
				ok = true;
				let res: rm.IRestResponse<ResEvaluateRaw> = await rest.get<ResEvaluateRaw>(infos.httpsAddress + "/mod/vpl/webservice.php?moodlewsrestformat=json&wstoken=" + infos.wsToken + "&id=" + infos.activityId + "&wsfunction=mod_vpl_get_result", optget);
				if (res.result) {
					getOutputChannel().clear();
					if (createCompilationReport("" + res.result.compilation)) {
						getOutputChannel().appendLine("Evaluation:\n" + res.result.evaluation);
						getOutputChannel().show(true);
					}
					commandDataProvider.setDescription(dico["extension.vpl.evaluate"], '' + res.result.grade, true);
				}
			} catch (err) {
				ok = false;
				//vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + dico["global.error.connectivity"]);
				//commandDataProvider.refresh(2);
			}
		}
	} while (!ok);
}

async function getOriginalFiles(user: boolean = false, infos: any = undefined) {
	if (currentFolder) {
		let files: (VPLFile[] | undefined);
		if (user) {
			files = await getUserCurrentFilesInfo(infos);
		} else {
			files = await getOriginalFilesInfo(infos);
		}
		if (files) {
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
	await addDefaultWorkspace();
	let files: (VPLFile[] | undefined) = await getOriginalFilesInfo();
	if (files) {
		var editor = vscode.window.activeTextEditor;
		if (editor) {
			let folder = vscode.Uri.file(path.dirname(editor.document.uri.fsPath));
			if (checkRequiredFilesArePresent(folder, files)) {
				var ok: boolean = true;
				do {
					var infos = await getAccessInfo();
					if (infos) {
						ok = true;
						try {
							var filedata = readFiles(vscode.Uri.file(path.dirname(editor.document.uri.fsPath)), files);
							var res = await rest.client.post(infos.httpsAddress + "/mod/vpl/webservice.php?moodlewsrestformat=json&wstoken=" + infos.wsToken + "&id=" + infos.activityId + '&wsfunction=mod_vpl_save' + filedata, "", optget);
							let body: VPLException = JSON.parse(await res.readBody());
							if (body) {
								ok = false;
							} else {
								if (checkFilesAreCorrectlySaved(folder)) {
									commandDataProvider.setDescription(dico["extension.vpl.save"], dico["saveUserFiles.filesaved"]);
									setTimeout(() => {
										commandDataProvider.setDescription(dico["extension.vpl.save"], '');
									}, 2000);
									return true;
								}
							}
						} catch (err) {
							//vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + dico["global.error.connectivity"]);
							//commandDataProvider.refresh(2);
							ok = false;
						}
					}
				} while (!ok);
			}
		}
	}
	return false;
}


async function evaluateUserFiles() {
	await addDefaultWorkspace();
	let done: boolean = await saveUserFiles();
	var ok: boolean = true;
	if (done) {
		do {
			ok = true;
			var infos = await getAccessInfo();
			if (infos) {
				try {
					let res: rm.IRestResponse<EvaluateRaw> = await rest.get<EvaluateRaw>(infos.httpsAddress + "/mod/vpl/webservice.php?moodlewsrestformat=json&wstoken=" + infos.wsToken + "&id=" + infos.activityId + '&wsfunction=mod_vpl_evaluate', optget);
					if (res.result) {
						if (res.result.exception) {
							ok = false;
						} else {
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

					} else {
						ok = false;
						//vscode.window.showErrorMessage(dico["global.ws.evaluation.error"]);
					}
				} catch (err) {
					ok = false;
					//vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + dico["global.error.connectivity"]);
					//commandDataProvider.refresh(2);
				}
			}
		} while (!ok);
	}

}

async function getValidCookies() {
	if (currentFolder) {
		//RETRIEVE THE VPL ACCESS INFORMATION FROM THE CURRENT FOLDER AND RETURN IT
		var conf = vscode.workspace.getConfiguration('', currentFolder);
		var x = conf.inspect('VPL4VSCode.moodleAddress');

		var httpsAddress: (string | undefined) = conf.get('VPL4VSCode.moodleAddress');
		var activityId: (string | undefined) = conf.get('VPL4VSCode.activityId');
		var localcookies: (string | undefined) = conf.get('VPL4VSCode.moodleCookies');
		if (localcookies) {
			var resp = await fetch(httpsAddress + '/mod/vpl/views/show_webservice.php?id=' + activityId, { 'headers': { 'cookie': localcookies } });
			if ((!resp.ok) || resp.redirected) {
				var err = resp.statusText
			} else {
				var t = await resp.text();
				cookies = localcookies;
				optget = {
					additionalHeaders: {
						'user-agent': 'vscode-restclient',
						'host': (httpsAddress ? httpsAddress.substr(8) : ''),
						'cookie': cookies
					}
				};
				let opt: IRequestOptions = {
					allowRetries: true, ignoreSslError: true, allowRedirects: true, maxRedirects: 100, headers:
					{
						'user-agent': 'vscode-restclient',
						'host': (httpsAddress ? httpsAddress.substr(8) : ''),
						'cookie': cookies
					}
				};

				rest = new rm.RestClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.183 Safari/537.36', undefined, undefined, opt);
				return;
			}

		}
		browser = await puppeteer.launch({ args: ['--disable-web-security',], "headless": false });
		const pages = await browser.pages();
		const page = pages[0];
		await page.goto(httpsAddress + '/mod/vpl/views/show_webservice.php?id=' + activityId)
		await page.waitForResponse(httpsAddress + '/mod/vpl/views/show_webservice.php?id=' + activityId, { timeout: 0 });
		await page.waitForNavigation();
		var t = await page.content();
		cookies = (await page.cookies()).map((cookie) => { return `${cookie.name}=${cookie.value}`; }).join('; ');
		page.close();
		browser.close();
		await conf.update('VPL4VSCode.moodleCookies', cookies, vscode.ConfigurationTarget.WorkspaceFolder);
		optget = {
			additionalHeaders: {
				'user-agent': 'vscode-restclient',
				'host': (httpsAddress ? httpsAddress.substr(8) : ''),
				'cookie': cookies
			}
		};
		let opt: IRequestOptions = {
			allowRetries: true, ignoreSslError: true, allowRedirects: true, maxRedirects: 100, headers:
			{
				'user-agent': 'vscode-restclient',
				'host': (httpsAddress ? httpsAddress.substr(8) : ''),
				'cookie': cookies
			}
		};

		rest = new rm.RestClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.183 Safari/537.36', undefined, undefined, opt);
	}

}


async function runUserFiles(debug = false) {
	await addDefaultWorkspace();
	let done: boolean = await saveUserFiles();
	if (done) {
		var ok: boolean = true;
		do {
			ok = true;
			var infos = await getAccessInfo();
			if (infos) {
				try {
					commandDataProvider.setDescription((debug ? dico["extension.vpl.debug"] : dico["extension.vpl.run"]), dico["global.ws.processing"]);
					let res: rm.IRestResponse<EvaluateRaw> = await rest.get<EvaluateRaw>(infos.httpsAddress + "/mod/vpl/webservice.php?moodlewsrestformat=json&wstoken=" + infos.wsToken + "&id=" + infos.activityId + '&wsfunction=' + (debug ? 'mod_vpl_debug' : 'mod_vpl_run'), optget);
					if (res.result) {
						if (res.result.exception) {
							ok = false;
						} else {
							return new Promise((resolve) => {
								const WebSocket = require('ws');
								if (res.result === null) {
									resolve();
									return;
								} else {
									var URLm = res.result.monitorURL;
									var URLe = res.result.executeURL;
									var ws = new WebSocket(URLm);
									var abort = false;
									ws.on('error', function incoming() {
										vscode.window.showErrorMessage(dico["global.ws.reachability"] + URLm);
									});

									ws.on('close', function open() {
										setTimeout(() => {
											commandDataProvider.setDescription((debug ? dico["extension.vpl.debug"] : dico["extension.vpl.run"]), '');
										}, 2000);
										resolve();
									});

									ws.on('open', function open() {
										commandDataProvider.setDescription((debug ? dico["extension.vpl.debug"] : dico["extension.vpl.run"]), dico["global.ws.connecting"]);
									});
									ws.on('message', async function incoming(data: string) {
										if (!abort) {
											var d = data.replace("message:", "");
											//console.log(data);
											if (data.startsWith("compilation:")) {
												var problem: boolean | undefined = await createCompilationReport("" + data.substr(12));
												if (!problem) {
													abort = true;
													commandDataProvider.setDescription((debug ? dico["extension.vpl.debug"] : dico["extension.vpl.run"]), dico["extension.vpl.compilation_problem"]);
													ws.send("close:");
													ws.close();
													resolve();
													return;
												}
											}
											commandDataProvider.setDescription((debug ? dico["extension.vpl.debug"] : dico["extension.vpl.run"]), d.charAt(0).toUpperCase() + d.slice(1));
											if (data.startsWith("run:vnc")) {
												var path = URLe.slice(URLe.lastIndexOf("/", URLe.lastIndexOf("/", URLe.lastIndexOf("/") - 1) - 1) + 1);
												var host = URLe.substr(6, URLe.indexOf(path) - 6);
												var url = 'http://localhost:33400/vnc/vnc_lite.html?host=' + host + '&password=' + data.slice(8) + '&path=' + path;
												openweb(url);
											}
											if (data === "run:terminal") {
												const wse = new WebSocket(URLe);
												let writeEmitter = new vscode.EventEmitter<string>();
												let pty: any = {
													onDidWrite: writeEmitter.event,
													open: () => { },
													close: () => { },
													handleInput: (data: string) => {
														wse.send(data);
													}
												};
												if (VPLShell) {
													VPLShell.dispose();
												}
												VPLShell = (<any>vscode.window).createTerminal({ name: `VPL Shell`, pty });
												vscode.commands.executeCommand('workbench.action.terminal.clear');
												VPLShell.show();

												wse.on('error', function incoming() {
													vscode.window.showErrorMessage(dico["global.ws.reachability"] + URLm);
												});

												wse.on('close', function open() {
													commandDataProvider.setDescription((debug ? dico["extension.vpl.debug"] : dico["extension.vpl.run"]), '');
													ws.close();
													resolve();
												});

												wse.on('open', function open() {
													commandDataProvider.setDescription((debug ? dico["extension.vpl.debug"] : dico["extension.vpl.run"]), dico["global.ws.connecting"]);
												});

												wse.on('message', function incoming(data: string) {
													writeEmitter.fire(data);
												});
											}
										}
									});
								}

							});
						}
					}

				} catch (err) {
					ok = false;
					//vscode.window.showErrorMessage(dico["global.error.reachability"] + ' ' + dico["global.error.connectivity"]);
					//commandDataProvider.refresh(2);
				}
			}
		} while (!ok);
	}
}

async function addDefaultWorkspace() {
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		vscode.workspace.updateWorkspaceFolders(0, 0, { uri: faqFolder });
	}
}

async function openFAQ() {
	await addDefaultWorkspace();
	vscode.commands.executeCommand("markdown.showPreview", faq);
}

export async function activate(context: vscode.ExtensionContext) {
	faqFolder = vscode.Uri.file(context.extensionPath + '/resources/faq');
	faq = vscode.Uri.file(context.extensionPath + '/resources/faq/README.md');
	if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
		//Adding default workspace to avoid problems
		await addDefaultWorkspace();
		return;
	}


	context.subscriptions.push(vscode.window.registerUriHandler({
		//vscode://GuillaumeBlin.vpl4vscode/open?https://moodle1.u-bordeaux.fr/mod/vpl/webservice.php?moodlewsrestformat=json&wstoken=d43777a617622a37e8f5dbfe86b5d0a1&id=173773&wsfunction=
		async handleUri(uri: vscode.Uri) {
			await addDefaultWorkspace();
			const { path, query } = uri;
			if (path === "/open") {
				vscode.commands.executeCommand("workbench.view.extension.vpl-bdx");
				if ((query.indexOf("wstoken") > -1) && (query.indexOf("id") > -1)) {
					//detect if id is the current activity id to renew token or open new activity otherwise
					var id = query.split("&")[2].split("=")[1];
					if (vscode.workspace.workspaceFolders) {
						const savedCurrentFolder = currentFolder;
						for (const e of vscode.workspace.workspaceFolders) {
							await setCurrentFolder(e.uri);
							var infos = await getAccessInfo();
							if (infos && "" + infos.activityId === id) {
								openFolder(e.uri);
								vscode.commands.executeCommand("extension.vpl_renewtoken", query, e.uri);
								return;
							}
						}
						currentFolder = savedCurrentFolder;
					}
					vscode.commands.executeCommand("extension.vpl_open", query);
				}
			}
		}
	}));
	vscode.commands.registerCommand('fileExplorer.openFile', (resource) => vscode.window.showTextDocument(resource));
	vscode.commands.registerCommand('extension.vpl_faq', () => openFAQ());

	const treeDataProvider = new FileSystemProvider(undefined);
	commandDataProvider = new VPLNodeProvider(context);

	vscode.window.onDidChangeActiveTextEditor(async (textEditor) => {
		if (!textEditor) {
			return;
		}
		var worksp = vscode.workspace.getWorkspaceFolder(textEditor.document.uri);
		if (worksp) {
			treeDataProvider.refresh(worksp);
			var conf = vscode.workspace.getConfiguration('', worksp.uri);
			if (conf.get("VPL4VSCode.wsToken", vscode.ConfigurationTarget.WorkspaceFolder)) {
				currentFolder = worksp.uri;
				var infos = await getAccessInfo();
				var tokenValid = await getOriginalFilesInfo(infos);
				if (tokenValid) {
					commandDataProvider.refresh(1);
				} else {
					commandDataProvider.refresh(2);
				}
			} else {
				commandDataProvider.refresh();
			}
		}
	});

	vscode.window.registerTreeDataProvider("vpl-commands", commandDataProvider);
	vscode.window.createTreeView("vpl-explorer", { treeDataProvider });

	let disposable = vscode.commands.registerCommand('extension.vpl_show_description', async () => {
		await addDefaultWorkspace();
		if (currentFolder) {
			var content: string = vscode.workspace.getConfiguration('', currentFolder).get('VPL4VSCode.intro') || '';
			var regex = /.*/;
			if (config) {
				if (config['locale'] === "fr") {
					regex = /{\s*mlang\s+\b(?!fr\b)\w+\s*}(.*?){\s*mlang\s*}/gis;
				}
				if (config['locale'] === "en") {
					regex = /{\s*mlang\s+\b(?!en\b)\w+\s*}(.*?){\s*mlang\s*}/gis;
				}
				VPLPanel.createOrShow(context.extensionPath, content.replace(regex, "").replace(/{\s*mlang\s*\w*\s*}/gis, ""));
			}
		}

	});

	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand('extension.vpl_open', async (url: string = '') => {
		try {
			commandDataProvider.setDescription(dico["extension.vpl.open"], dico["global.ws.processing"]);
			await addDefaultWorkspace();
			var folders = vscode.workspace.workspaceFolders;
			var nbFolders = 0;
			if (folders) {
				nbFolders = folders.length;
			}
			if (url === '') {
				url = await vscode.env.clipboard.readText();
				vscode.env.clipboard.writeText('');
			}
			if ((url.indexOf("mod/vpl") > -1) && (url.indexOf("id=") > -1)) {
				var q: string = vscode.Uri.parse(url).query;
				if (q.indexOf("&") > -1) {
					q = q.substr(q.indexOf("id=") + 3, q.indexOf("&", q.indexOf("id=")) - (q.indexOf("id=") + 3));
				} else {
					q = q.substr(q.indexOf("id=") + 3);
				}
				await setProjectFolder('https://' + vscode.Uri.parse(url).authority, q);

			} else {
				var value = await vscode.window.showQuickPick([dico["extension.open.existing"], dico["extension.open.new"]], { placeHolder: dico["extension.open.choice"], ignoreFocusOut: true });
				//Opening an already configured project
				if (!value) {
					return;
				}
				if (value == dico["extension.open.new"]) {
					var host = await vscode.window.showInputBox({ value: "https://moodle1.u-bordeaux.fr", placeHolder: "Your Moodle server address", ignoreFocusOut: true });
					if (!host) {
						return;
					}
					var activityId = await vscode.window.showInputBox({ value: "218928", placeHolder: "The activity id", ignoreFocusOut: true });
					if (!activityId) {
						return;
					}
					//await setAccessInfo(host,activityId);
					await setProjectFolder(host, activityId);

				}
				if (value == dico["extension.open.existing"]) {
					const options: vscode.OpenDialogOptions = {
						canSelectMany: false,
						openLabel: 'Open',
						canSelectFolders: true,
						canSelectFiles: false
					};
					vscode.workspace.onDidChangeWorkspaceFolders(async e => {
						for (const added of e.added) {
							setCurrentFolder(added.uri);
							openFolder(added.uri);
						}
					});
					vscode.window.showOpenDialog(options).then(async f => {
						if (f) {
							var folder: vscode.Uri = f[0];
							var oldCurrentFolder = currentFolder;
							currentFolder = folder;
							const selected = vscode.workspace.getWorkspaceFolder(folder);
							if (selected) { //already an open workspace
								setCurrentFolder(selected.uri);
								openFolder(selected.uri);

							} else {
								vscode.workspace.updateWorkspaceFolders(nbFolders, 0, { uri: folder });
							}
							/*	var infos = await getAccessInfo();
								if (!infos) {
									vscode.window.showErrorMessage(dico["global.error.configuration"]);
									return;
								}*/
						}
					});
				}

			}
		} finally {
			commandDataProvider.setDescription(dico["extension.vpl.open"], '');
		}
	});

	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('extension.vpl_renewtoken', async (url: string = '', uri: vscode.Uri | undefined = undefined) => {
		try {
			await addDefaultWorkspace();
			commandDataProvider.setDescription(dico["extension.vpl.renew_token"], dico["global.ws.processing"]);
			var infos = await getAccessInfo();
			if (infos && infos.activityId) {

				setCurrentFolder();

				commandDataProvider.setDescription(dico["extension.vpl.renew_token"], dico["extension.vpl_renewtoken.info"]);
				setTimeout(() => {
					commandDataProvider.setDescription(dico["extension.vpl.renew_token"], '');
					commandDataProvider.refresh(1);
				}, 2000);
			}
			/*
			else{
				if (url === '') {
					url = await vscode.env.clipboard.readText();
				}
			if (url.indexOf("wstoken") > -1) {
				commandDataProvider.refresh(3);
				var editor = vscode.window.activeTextEditor;
				var folder: string;
				if (!uri && editor) {
					uri = editor.document.uri;
					folder = uri.fsPath;
					if (uri.scheme === "file") {
						folder = path.dirname(uri.fsPath);
					}
				} else {
					if (uri) {
						folder = uri.fsPath;
					} else {
						vscode.window.showErrorMessage(dico["extension.vpl_open.error"]);
						return;
					}
				}
				if (uri) {
					setCurrentFolder(vscode.Uri.file(folder));
					await setAccessInfo(url);
					commandDataProvider.setDescription(dico["extension.vpl.renew_token"], dico["extension.vpl_renewtoken.info"]);
					setTimeout(() => {
						commandDataProvider.setDescription(dico["extension.vpl.renew_token"], '');
						commandDataProvider.refresh(1);
					}, 2000);
				}
				
			} else {
				vscode.window.showErrorMessage(dico["extension.vpl_open.error"]);
			}*/
		} finally {
			commandDataProvider.setDescription(dico["extension.vpl.renew_token"], '');
		}
	});

	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('extension.vpl_load', async () => {
		try {
			await addDefaultWorkspace();
			commandDataProvider.setDescription(dico["extension.vpl.load"], dico["global.ws.processing"]);
			setCurrentFolder();
			await getUserCurrentFiles();
		} finally {
			commandDataProvider.setDescription(dico["extension.vpl.load"], '');
		}
	});

	context.subscriptions.push(disposable);


	disposable = vscode.commands.registerCommand('extension.vpl_reset', async () => {

		var res = vscode.window.showWarningMessage(dico["extension.vpl_reset.warning"], dico["global.yes"], dico["global.no"]);
		res.then((value) => {
			try {
				addDefaultWorkspace();
				commandDataProvider.setDescription(dico["extension.vpl.reset_files"], dico["global.ws.processing"]);

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
			} finally {
				commandDataProvider.setDescription(dico["extension.vpl.reset_files"], '');
			}
		}, () => vscode.window.showErrorMessage(dico["global.error.resetting"] + ' ${err}'));

	});

	context.subscriptions.push(disposable);
	disposable = vscode.commands.registerCommand('extension.vpl_save', async () => {
		try {
			await addDefaultWorkspace();
			commandDataProvider.setDescription(dico["extension.vpl.save"], dico["global.ws.processing"]);
			setCurrentFolder();
			await saveUserFiles();
		} finally {
			commandDataProvider.setDescription(dico["extension.vpl.save"], '');
		}
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
		try {
			await addDefaultWorkspace();
			commandDataProvider.setDescription(dico["extension.vpl.evaluate"], dico["global.ws.processing"]);
			setCurrentFolder();
			await evaluateUserFiles();
		} finally {
			commandDataProvider.setDescription(dico["extension.vpl.evaluate"], '');
		}
	});

	context.subscriptions.push(disposable);
	disposable = vscode.commands.registerCommand('extension.vpl_run', async () => {
		try {
			await addDefaultWorkspace();
			commandDataProvider.setDescription(dico["extension.vpl.run"], dico["global.ws.processing"]);
			setCurrentFolder();
			await runUserFiles();
		} finally {
			commandDataProvider.setDescription(dico["extension.vpl.run"], '');
		}

	});

	context.subscriptions.push(disposable);

	disposable = vscode.commands.registerCommand('extension.vpl_debug', async () => {
		try {
			await addDefaultWorkspace();
			commandDataProvider.setDescription(dico["extension.vpl.debug"], dico["global.ws.processing"]);
			setCurrentFolder();
			await runUserFiles(true);
		} finally {
			commandDataProvider.setDescription(dico["extension.vpl.debug"], '');
		}
	});

	context.subscriptions.push(disposable);


	vscode.workspace.getConfiguration('liveServer.settings').update("port", 33400, vscode.ConfigurationTarget.Global);
	vscode.workspace.getConfiguration('liveServer.settings').update("NoBrowser", true, vscode.ConfigurationTarget.Global);
	vscode.workspace.getConfiguration('liveServer.settings').update("donotShowInfoMsg", true, vscode.ConfigurationTarget.Global);
	vscode.workspace.getConfiguration('liveServer.settings').update("multiRootWorkspaceName", "faq", vscode.ConfigurationTarget.Global);
	let ext = vscode.extensions.getExtension("GuillaumeBlin.vpl4vscode");

	if (ext) {
		vscode.commands.executeCommand("extension.liveServer.goOnline")
	}

	setInterval(()=>{getValidToken();},10000);
}

// this method is called when your extension is deactivated
export function deactivate() { }



class VPLNodeProvider implements vscode.TreeDataProvider<TreeItem> {
	data: TreeItem[];
	menus: TreeItem[][];
	state: number = 0;
	private _onDidChangeTreeData: vscode.EventEmitter<any> = new vscode.EventEmitter<any>();
	readonly onDidChangeTreeData: vscode.Event<any> = this._onDidChangeTreeData.event;


	constructor(private context: vscode.ExtensionContext) {
		this.data = [new TreeItem(this.context, dico["extension.vpl.faq"], {
			command: 'extension.vpl_faq',
			arguments: [this.context],
			title: ''
		}, 'hands-helping-solid'),
		new TreeItem(this.context, dico["extension.vpl.open"], {
			command: 'extension.vpl_open',
			title: ''
		}, 'paperclip-solid')];
		this.menus = [[
			new TreeItem(this.context, dico["extension.vpl.faq"], {
				command: 'extension.vpl_faq',
				arguments: [this.context],
				title: ''
			}, 'hands-helping-solid'),
			new TreeItem(this.context, dico["extension.vpl.open"], {
				command: 'extension.vpl_open',
				title: ''
			}, 'paperclip-solid')
		],
		[
			new TreeItem(this.context, dico["extension.vpl.faq"], {
				command: 'extension.vpl_faq',
				arguments: [this.context],
				title: ''
			}, 'hands-helping-solid'),
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
			}, 'eye-solid'), new TreeItem(this.context, dico["extension.vpl.show_problems"], {
				command: 'workbench.action.problems.focus',
				title: ''
			}, 'eye-solid')]),
			new TreeItem(this.context, dico["extension.vpl.debug"], {
				command: 'extension.vpl_debug',
				title: ''
			}, 'bug-solid', [new TreeItem(this.context, dico["extension.vpl.show_output"], {
				command: 'extension.vpl_show_output',
				title: ''
			}, 'eye-solid'), new TreeItem(this.context, dico["extension.vpl.show_problems"], {
				command: 'workbench.action.problems.focus',
				title: ''
			}, 'eye-solid')]),
			new TreeItem(this.context, dico["extension.vpl.evaluate"], {
				command: 'extension.vpl_evaluate',
				title: ''
			}, 'check-square-solid', [new TreeItem(this.context, dico["extension.vpl.show_report"], {
				command: 'extension.vpl_show_report',
				title: ''
			}, 'eye-solid'), new TreeItem(this.context, dico["extension.vpl.show_problems"], {
				command: 'workbench.action.problems.focus',
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
			new TreeItem(this.context, dico["extension.vpl.faq"], {
				command: 'extension.vpl_faq',
				arguments: [this.context],
				title: ''
			}, 'hands-helping-solid'),
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
			new TreeItem(this.context, dico["extension.vpl.faq"], {
				command: 'extension.vpl_faq',
				arguments: [this.context],
				title: ''
			}, 'hands-helping-solid'),
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

	setDescription(element: string, description: string, reseticon: boolean = false) {
		this.data.forEach(e => {
			if (e.label === element) {
				if (reseticon || description === '') {
					e.resetIconPath();
				} else {
					if (!e.waiting) {
						e.setWaitingIcon();
					}

				}
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
		this.state = state;
		this.data = this.menus[state];
		this.data.forEach(e => {
			e.resetDescription();
		});
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
	icon: string = '';
	waiting: boolean = false;
	orig_description: string = '';
	constructor(private context: vscode.ExtensionContext, label: string, command: vscode.Command, icon: string, child: TreeItem[] | undefined = undefined) {
		super(
			label, (child ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None));
		this.icon = icon;
		this.orig_description = label;
		this.command = command;
		this.iconPath = {
			dark: this.context.asAbsolutePath(path.join('resources', icon + '-dark.svg')),
			light: this.context.asAbsolutePath(path.join('resources', icon + '-light.svg'))
		};
		if (child) {
			child.forEach(e => { this.children.push(e); });
		}

	}

	setWaitingIcon() {
		this.iconPath = {
			dark: this.context.asAbsolutePath(path.join('resources', 'spinner-solid.gif')),
			light: this.context.asAbsolutePath(path.join('resources', 'spinner-solid.gif'))
		};
		this.waiting = true;
	}

	resetIconPath() {
		this.waiting = false;
		this.iconPath = {
			dark: this.context.asAbsolutePath(path.join('resources', this.icon + '-dark.svg')),
			light: this.context.asAbsolutePath(path.join('resources', this.icon + '-light.svg'))
		};
	}

	resetDescription() {
		this.description = this.orig_description;
	}
	getChildren() {
		return this.children;
	}
}




/**
 * Manages cat coding webview panels
 */
class VPLPanel {
	/**
	 * Track the currently panel. Only allow a single panel to exist at a time.
	 */
	public static currentPanel: VPLPanel | undefined;

	public static readonly viewType = 'VPL';

	private readonly _panel: vscode.WebviewPanel;
	private _disposables: vscode.Disposable[] = [];

	public static createOrShow(extensionPath: string, content: string = '') {
		const column = vscode.window.activeTextEditor
			? vscode.window.activeTextEditor.viewColumn
			: undefined;

		// If we already have a panel, show it.
		if (VPLPanel.currentPanel) {
			VPLPanel.currentPanel._panel.reveal(column);

		} else {

			// Otherwise, create a new panel.
			const panel = vscode.window.createWebviewPanel(
				VPLPanel.viewType,
				'Description',
				column || vscode.ViewColumn.One,
				{
					// Enable javascript in the webview
					enableScripts: true,

					// And restrict the webview to only loading content from our extension's `media` directory.
					localResourceRoots: [vscode.Uri.file(path.join(extensionPath, 'media'))]
				}
			);

			VPLPanel.currentPanel = new VPLPanel(panel, extensionPath);
		}
		VPLPanel.currentPanel._update(content);
	}

	public static revive(panel: vscode.WebviewPanel, extensionPath: string) {
		VPLPanel.currentPanel = new VPLPanel(panel, extensionPath);
	}

	private constructor(panel: vscode.WebviewPanel, extensionPath: string) {
		this._panel = panel;

		// Set the webview's initial html content
		this._update('');

		// Listen for when the panel is disposed
		// This happens when the user closes the panel or when the panel is closed programatically
		this._panel.onDidDispose(() => this.dispose(), null, this._disposables);


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
		VPLPanel.currentPanel = undefined;

		// Clean up our resources
		this._panel.dispose();

		while (this._disposables.length) {
			const x = this._disposables.pop();
			if (x) {
				x.dispose();
			}
		}
	}

	public _update(content: string) {
		const webview = this._panel.webview;
		// And the uri we use to load this script in the webview

		webview.html = `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Description</title>
            </head>
            <body>
                ${content}
            </body>
            </html>`;
	}
}
