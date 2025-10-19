import * as vscode from 'vscode';
// Import Node.js modules for handling file paths and the file system
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

// This will store our recorded events in memory.
let eventLog: CodeEvent[] = [];
let isRecording = false;

function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "CodeReplay" is now active!');

    // === RECORDING COMMANDS (Unchanged) ===
    const startRecordingCommand = vscode.commands.registerCommand('codereplay.startRecording', () => {
        eventLog = [];
        isRecording = true;
        vscode.window.showInformationMessage('CodeReplay: Recording started!');
    });

    const stopRecordingCommand = vscode.commands.registerCommand('codereplay.stopRecording', () => {
        isRecording = false;
        vscode.window.showInformationMessage(`CodeReplay: Recording stopped. Captured ${eventLog.length} events.`);
        console.log("--- Event Log Captured ---", eventLog);
    });

    // === THE NEW PLAYBACK COMMAND ===
    const startPlaybackCommand = vscode.commands.registerCommand('codereplay.startPlayback', async () => {
        if (eventLog.length === 0) {
            vscode.window.showInformationMessage('CodeReplay: No recording to play back.');
            return;
        }

        // Get the root folder of the current workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('CodeReplay: You must be in a workspace (folder) to run playback.');
            return;
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        vscode.window.showInformationMessage('CodeReplay: Playback starting in 3 seconds...');
        await delay(3000);

        // This map will store our *new* playback file paths
        // Key: Original file URI (e.g., "file:///.../index.html")
        // Value: New file URI (e.g., "file:///.../index(playback).html")
        const playbackFileMap = new Map<string, vscode.Uri>();

        // This map will store the open editors for our new playback files
        const openEditors = new Map<string, vscode.TextEditor>();

        for (const event of eventLog) {
            let playbackFileUri = playbackFileMap.get(event.file);

            // If this is the first time we've seen this file, create its playback clone
            if (!playbackFileUri) {
                const originalUri = vscode.Uri.parse(event.file);
                
                // Parse the original filename
                const originalPath = originalUri.fsPath;
                const fileInfo = path.parse(originalPath);
                
                // Create the new name: "index" + "(playback)" + ".html"
                const playbackName = `${fileInfo.name}(playback)${fileInfo.ext}`;
                
                // Create the new file's full path
                const playbackPath = path.join(workspaceRoot, playbackName);
                
                // Create the file on disk (it's empty for now)
                fs.writeFileSync(playbackPath, ''); 
                
                playbackFileUri = vscode.Uri.file(playbackPath);
                playbackFileMap.set(event.file, playbackFileUri); // Save it for next time
            }

            // Now, open the *new* playback file
            let editor = openEditors.get(playbackFileUri.toString());
            
            if (!editor || vscode.window.activeTextEditor?.document.uri.toString() !== playbackFileUri.toString()) {
                const document = await vscode.workspace.openTextDocument(playbackFileUri);
                editor = await vscode.window.showTextDocument(document, { preview: false });
                openEditors.set(playbackFileUri.toString(), editor);
            }
            
            // Apply the edit as usual
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
                
                await delay(50); // Keystroke speed
            } else if (event.type === 'switch_file') {
                await delay(200); // File switch speed
            }
        }
        vscode.window.showInformationMessage('CodeReplay: Playback finished!');
    });

    // === EVENT LISTENERS (Unchanged) ===
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

    context.subscriptions.push(startRecordingCommand, stopRecordingCommand, startPlaybackCommand);
}   

export function deactivate() {}