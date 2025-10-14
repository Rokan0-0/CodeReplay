import * as vscode from 'vscode';

// This will store our recorded events.
// The 'any' type is temporary; we'll define a proper structure later.
let eventLog: any[] = [];
let isRecording = false;

// This method is called when your extension is activated
export function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "CodeReplay" is now active!');

    // The command to START recording
    let startRecordingCommand = vscode.commands.registerCommand('codereplay.startRecording', () => {
        eventLog = []; // Clear previous recording
        isRecording = true;
        vscode.window.showInformationMessage('CodeReplay: Recording started!');
    });

    // The command to STOP recording
    let stopRecordingCommand = vscode.commands.registerCommand('codereplay.stopRecording', () => {
        isRecording = false;
        vscode.window.showInformationMessage(`CodeReplay: Recording stopped. Captured ${eventLog.length} events.`);
        console.log(eventLog); // For debugging, we'll print the events to the console
    });

    // LISTENER for text changes (typing, deleting, pasting)
    vscode.workspace.onDidChangeTextDocument(event => {
        if (isRecording && event.contentChanges.length > 0) {
            const timestamp = new Date().toISOString();
            const file = event.document.uri.toString();

            for (const change of event.contentChanges) {
                const recordedEvent = {
                    type: 'edit',
                    timestamp,
                    file,
                    range: {
                        start: { line: change.range.start.line, character: change.range.start.character },
                        end: { line: change.range.end.line, character: change.range.end.character }
                    },
                    text: change.text,
                    rangeLength: change.rangeLength
                };
                eventLog.push(recordedEvent);
            }
        }
    });

    // LISTENER for switching files
    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (isRecording && editor) {
            const timestamp = new Date().toISOString();
            const file = editor.document.uri.toString();
            eventLog.push({
                type: 'switch_file',
                timestamp,
                file
            });
        }
    });

    context.subscriptions.push(startRecordingCommand, stopRecordingCommand);
}

// This method is called when your extension is deactivated
export function deactivate() {}