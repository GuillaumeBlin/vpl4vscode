import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';



export class VPLNodeProvider implements vscode.TreeDataProvider<TreeItem> {
    onDidChangeTreeData?: vscode.Event<TreeItem | null | undefined> | undefined;

    data: TreeItem[];

    constructor() {
        this.data = [new TreeItem('Fiesta'), new TreeItem('Focus'), new TreeItem('Mustang')];
    }

    getTreeItem(element: TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
        return element;
    }

    getChildren(element?: TreeItem | undefined): vscode.ProviderResult<TreeItem[]> {
        if (element === undefined) {
            return this.data;
        }
        return element.children;
    }
}

class TreeItem extends vscode.TreeItem {
    children: TreeItem[] | undefined;

    constructor(label: string, children?: TreeItem[]) {
        super(
            label,
            children === undefined ? vscode.TreeItemCollapsibleState.None :
                vscode.TreeItemCollapsibleState.Expanded);
        this.children = children;
    }
}
