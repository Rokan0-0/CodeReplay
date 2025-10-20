import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

type CodeEvent = {
    type: 'edit' | 'switch_file';
    timestamp: string;
    file: string; // The URI string of the *original* recorded file
    range?: { start: { line: number; character: number; }; end: { line: number; character: number; }; };
    text?: string;
    rangeLength?: number;
};

// --- Global Variables ---
let eventLog: CodeEvent[] = [];
let isRecording = false;

// We declare our new UI buttons here so they can be accessed from anywhere
let recordButton: vscode.StatusBarItem;
let playButton: vscode.StatusBarItem;


// --- Helper Function ---
function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Activation Function (Main Logic) ---
export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "CodeReplay" is now active!');

    // === 1. CREATE THE UI BUTTONS ===

    // Create the Record button
    recordButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    recordButton.command = 'codereplay.startRecording'; // The command it runs on click
    recordButton.text = `$(circle-filled) Record`; // Uses a built-in icon
    recordButton.tooltip = 'Start Recording Session';
    recordButton.show(); // Make it visible
    context.subscriptions.push(recordButton); // Add to disposable list

    // Create the Play button
    playButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    playButton.command = 'codereplay.startPlayback';
    playButton.text = `$(play) Play`;
    playButton.tooltip = 'Start Playback Session';
    playButton.show();
    context.subscriptions.push(playButton);


    // === 2. REGISTER THE COMMANDS ===

    // Start Recording Command
    const startRecordingCommand = vscode.commands.registerCommand('codereplay.startRecording', () => {
        eventLog = [];
        isRecording = true;
        vscode.window.showInformationMessage('CodeReplay: Recording started!');

        // Update the UI
        recordButton.text = `$(debug-stop) Stop`; // Change to a "Stop" button
        recordButton.command = 'codereplay.stopRecording'; // Change the command
        recordButton.tooltip = 'Stop Recording Session';
        playButton.hide(); // Hide the play button while recording
    });

    // Stop Recording Command
    const stopRecordingCommand = vscode.commands.registerCommand('codereplay.stopRecording', () => {
        isRecording = false;
        vscode.window.showInformationMessage(`CodeReplay: Recording stopped. Captured ${eventLog.length} events.`);

        // Reset the UI
        recordButton.text = `$(circle-filled) Record`;
        recordButton.command = 'codereplay.startRecording';
        recordButton.tooltip = 'Start Recording Session';
        playButton.show(); // Show the play button again
    });

    // Playback Command (Logic is unchanged, just moved)
    const startPlaybackCommand = vscode.commands.registerCommand('codereplay.startPlayback', async () => {
        if (eventLog.length === 0) {
            vscode.window.showInformationMessage('CodeReplay: No recording to play back.');
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('CodeReplay: You must be in a workspace (folder) to run playback.');
            return;
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        vscode.window.showInformationMessage('CodeReplay: Playback starting in 3 seconds...');
        await delay(3000);

        const playbackFileMap = new Map<string, vscode.Uri>();
        const openEditors = new Map<string, vscode.TextEditor>();

        for (const event of eventLog) {
            let playbackFileUri = playbackFileMap.get(event.file);

            if (!playbackFileUri) {
                const originalUri = vscode.Uri.parse(event.file);
                const originalPath = originalUri.fsPath;
                const fileInfo = path.parse(originalPath);
                const playbackName = `${fileInfo.name}(playback)${fileInfo.ext}`;
                const playbackPath = path.join(workspaceRoot, playbackName);
                
                fs.writeFileSync(playbackPath, ''); 
                
                playbackFileUri = vscode.Uri.file(playbackPath);
                playbackFileMap.set(event.file, playbackFileUri);
            }

            let editor = openEditors.get(playbackFileUri.toString());
            
            if (!editor || vscode.window.activeTextEditor?.document.uri.toString() !== playbackFileUri.toString()) {
                const document = await vscode.workspace.openTextDocument(playbackFileUri);
                editor = await vscode.window.showTextDocument(document, { preview: false });
                openEditors.set(playbackFileUri.toString(), editor);
            }
            
            if (event.type === 'edit' && event.range) {
                const start = new vscode.Position(event.range.start.line, event.range.start.character);
                const end = new vscode.Position(event.range.end.line, event.range.end.character);
                const range = new vscode.Range(start, end);

                await editor.edit(editBuilder => {
                    if (event.rangeLength && event.rangeLength > 0) {
                        editBuilder.delete(range);
                    }
                    if (event.text) {
                        editBuilder.insert(start, event.text);
                    }
                });
                
                await delay(50);
            } else if (event.type === 'switch_file') {
                await delay(200);
            }
        }
        vscode.window.showInformationMessage('CodeReplay: Playback finished!');
    });

    // === 3. SUBSCRIBE ALL COMMANDS ===
    context.subscriptions.push(startRecordingCommand, stopRecordingCommand, startPlaybackCommand);


    // === 4. EVENT LISTENERS (Unchanged) ===
    vscode.workspace.onDidChangeTextDocument(event => {
        if (isRecording && event.contentChanges.length > 0 && !event.document.isUntitled) {
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
        if (isRecording && editor && !editor.document.isUntitled) {
            const timestamp = new Date().toISOString();
            const file = editor.document.uri.toString();
            eventLog.push({ type: 'switch_file', timestamp, file });
        }
    });
}

export function deactivate() {
    // This function is called when the extension is deactivated
    // We should hide our buttons
    recordButton.dispose();
    playButton.dispose();
}