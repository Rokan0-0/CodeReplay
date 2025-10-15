import * as vscode from 'vscode';

// A more specific type for our events to make the code safer
type CodeEvent = {
    type: 'edit' | 'switch_file';
    timestamp: string;
    file: string;
    // 'edit' event properties
    range?: { start: { line: number; character: number; }; end: { line: number; character: number; }; };
    text?: string;
    rangeLength?: number;
};

// This will store our recorded events.
let eventLog: CodeEvent[] = [];
let isRecording = false;

// A simple delay function to control playback speed
function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "CodeReplay" is now active!');

    // === RECORDING COMMANDS ===
    const startRecordingCommand = vscode.commands.registerCommand('codereplay.startRecording', () => {
        eventLog = []; // Clear previous recording
        isRecording = true;
        vscode.window.showInformationMessage('CodeReplay: Recording started!');
    });

    const stopRecordingCommand = vscode.commands.registerCommand('codereplay.stopRecording', () => {
        isRecording = false;
        vscode.window.showInformationMessage(`CodeReplay: Recording stopped. Captured ${eventLog.length} events.`);
        console.log("--- Event Log Captured ---");
        console.log(eventLog);
    });

    // === PLAYBACK COMMAND ===
    const startPlaybackCommand = vscode.commands.registerCommand('codereplay.startPlayback', async () => {
        if (eventLog.length === 0) {
            vscode.window.showInformationMessage('CodeReplay: No recording to play back.');
            return;
        }

        vscode.window.showInformationMessage('CodeReplay: Playback starting in 3 seconds...');
        await delay(3000); // Give user time to prepare

        // Keep track of open files during playback
        const openEditors: { [uri: string]: vscode.TextEditor } = {};

        for (const event of eventLog) {
            const fileUri = vscode.Uri.parse(event.file);

            // Ensure the correct file is open and active
            let editor = openEditors[event.file];
            if (!editor || vscode.window.activeTextEditor?.document.uri.toString() !== event.file) {
                try {
                    const document = await vscode.workspace.openTextDocument(fileUri);
                    editor = await vscode.window.showTextDocument(document, { preview: false });
                    openEditors[event.file] = editor;
                } catch (e) {
                    console.error(`Could not open file ${event.file}`, e);
                    // Create an untitled file if it doesn't exist to avoid crashing
                    const document = await vscode.workspace.openTextDocument({ content: '', language: 'plaintext' });
                    editor = await vscode.window.showTextDocument(document);
                    openEditors[event.file] = editor;
                }
            }
            
            if (event.type === 'edit' && event.range) {
                // Apply the edit to the document
                const start = new vscode.Position(event.range.start.line, event.range.start.character);
                const end = new vscode.Position(event.range.end.line, event.range.end.character);
                const range = new vscode.Range(start, end);

                await editor.edit(editBuilder => {
                    // If rangeLength > 0, it's a deletion or replacement. If 0, it's an insertion.
                    if (event.rangeLength && event.rangeLength > 0) {
                        editBuilder.delete(range);
                    }
                    if (event.text) {
                        editBuilder.insert(start, event.text);
                    }
                });
                
                // Control the "typing" speed
                await delay(50); // 50ms delay between edits
            } else if (event.type === 'switch_file') {
                // The loop already handles switching, we just need a small pause
                await delay(200); // 200ms delay for file switches
            }
        }
        vscode.window.showInformationMessage('CodeReplay: Playback finished!');
    });

    // === EVENT LISTENERS (UNCHANGED) ===
    vscode.workspace.onDidChangeTextDocument(event => {
        if (isRecording && event.contentChanges.length > 0) {
            const timestamp = new Date().toISOString();
            const file = event.document.uri.toString();
            for (const change of event.contentChanges) {
                eventLog.push({
                    type: 'edit', timestamp, file,
                    range: { start: change.range.start, end: change.range.end },
                    text: change.text,
                    rangeLength: change.rangeLength
                });
            }
        }
    });

    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (isRecording && editor) {
            const timestamp = new Date().toISOString();
            const file = editor.document.uri.toString();
            eventLog.push({ type: 'switch_file', timestamp, file });
        }
    });

    context.subscriptions.push(startRecordingCommand, stopRecordingCommand, startPlaybackCommand);
}

export function deactivate() {}