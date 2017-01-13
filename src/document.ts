import {
    workspace, window, commands, TextDocumentContentProvider,
    Event, Uri, TextDocumentChangeEvent, ViewColumn, EventEmitter,
    TextDocument, Disposable
} from "vscode";
import * as path from "path";
import fileUrl = require("file-url");
import { SourceType } from "./extension";

export class HtmlDocumentView {
    private provider: HtmlDocumentContentProvider;
    private registrations: Disposable[] = [];
    private previewUri: Uri;
    private doc: TextDocument;

    constructor(document: TextDocument) {
        this.doc = document;
        this.provider = new HtmlDocumentContentProvider(this.doc);
        this.registrations.push(workspace.registerTextDocumentContentProvider("html", this.provider));
        this.previewUri = this.getHTMLUri(document.uri);
        this.registerEvents();
    }

    public get uri(): Uri {
        return this.previewUri;
    }

    private getHTMLUri(uri: Uri) {
        return uri.with({ scheme: 'html', path: uri.path + '.rendered', query: uri.toString() });
    }

    private registerEvents() {
        workspace.onDidSaveTextDocument(document => {
            if (this.isHTMLFile(document)) {
                const uri = this.getHTMLUri(document.uri);
                this.provider.update(uri);
            }
        });


        let isRunning = false;
        workspace.onDidChangeTextDocument(event => {
            if (this.isHTMLFile(event.document)) {
                const uri = this.getHTMLUri(event.document.uri);
                const p = this.provider;
                let updater = function() {
                    p.update(uri); 
                    isRunning = false;
                };
                if (!isRunning) {
                  isRunning = true;
                  setTimeout(updater, 3000); // Buffer 3 seconds for update
                }
            }
        });

        workspace.onDidChangeConfiguration(() => {
            workspace.textDocuments.forEach(document => {
                if (document.uri.scheme === 'html') {
                    // update all generated md documents
                    this.provider.update(document.uri);
                }
            });
        });
        this.registrations.push(workspace.onDidChangeTextDocument((e: TextDocumentChangeEvent) => {
            if (!this.visible) {
                return;
            }
            if (e.document === this.doc) {
                this.provider.update(this.previewUri);
            }
        }));
    }

    private get visible(): boolean {
        for (let i in window.visibleTextEditors) {
            if (window.visibleTextEditors[i].document.uri === this.previewUri) {
                return true;
            }
        }
        return false;
    }

    public execute(column: ViewColumn) {
        commands.executeCommand("vscode.previewHtml", this.previewUri, column, `Preview '${path.basename(this.uri.fsPath)}'`).then((success) => {
        }, (reason) => {
            console.warn(reason);
            window.showErrorMessage(reason);
        });
    }

    public dispose() {
        for (let i in this.registrations) {
            this.registrations[i].dispose();
        }
    }

    private isHTMLFile(document: TextDocument) {
        return document.languageId === 'html'
            && document.uri.scheme !== 'html'; // prevent processing of own documents
    }
}

class HtmlDocumentContentProvider implements TextDocumentContentProvider {
    private _onDidChange = new EventEmitter<Uri>();
    private doc: TextDocument;

    constructor(document: TextDocument) {
        this.doc = document;
    }

    public provideTextDocumentContent(uri: Uri): string {
        return this.createHtmlSnippet();
    }

    get onDidChange(): Event<Uri> {
        return this._onDidChange.event;
    }

    public update(uri: Uri) {
        this._onDidChange.fire(uri);
    }

    private createHtmlSnippet(): string {
        if (this.doc.languageId !== "html" && this.doc.languageId !== "jade") {
            return this.errorSnippet("Active editor doesn't show a HTML or Jade document - no properties to preview.");
        }
        return this.preview();
    }

    private errorSnippet(error: string): string {
        return `
                <body>
                    ${error}
                </body>`;
    }

    private createLocalSource(file: string, type: SourceType) {
        let source_path = fileUrl(
            path.join(
                __dirname,
                "..",
                "..",
                "static",
                file
            )
        );
        switch (type) {
            case SourceType.SCRIPT:
                return `<script src="${source_path}"></script>`;
            case SourceType.STYLE:
                return `<link href="${source_path}" rel="stylesheet" />`;
        }
    }

    private fixLinks(): string {
        return this.doc.getText().replace(
            new RegExp("((?:src|href)=[\'\"])((?!http|\\/).*?)([\'\"])", "gmi"),
            (subString: string, p1: string, p2: string, p3: string): string => {
                return [
                    p1,
                    fileUrl(path.join(
                        path.dirname(this.doc.fileName),
                        p2
                    )),
                    p3
                ].join("");
            }
        );
    }

    public preview(): string {
        return this.createLocalSource("header_fix.css", SourceType.STYLE) +
            this.createLocalSource("custom_updater.js", SourceType.SCRIPT) +
            this.fixLinks();
    }
}
