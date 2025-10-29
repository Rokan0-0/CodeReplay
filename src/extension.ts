import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

type CodeEvent = {
    type: 'edit' | 'switch_file';
    timestamp: string;
    file: string; 
    range?: { start: { line: number; character: number; }; end: { line: number; character: number; }; };
    text?: string;
    rangeLength?: number;
};

// --- Global Variables ---
let eventLog: CodeEvent[] = [];
let isRecording = false;
let fileSnapshots = new Map<string, string>();

let recordButton: vscode.StatusBarItem;
let playButton: vscode.StatusBarItem;
let cleanButton: vscode.StatusBarItem; // NEW: Cleanup button

// --- Helper Function ---
function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Activation Function (Main Logic) ---
export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "CodeReplay" is now active!');

    // === 1. CREATE THE RECORD BUTTON ===
    recordButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    recordButton.command = 'codereplay.startRecording';
    recordButton.text = `$(circle-filled) Record`;
    recordButton.tooltip = 'Start Recording Session';
    recordButton.show();
    context.subscriptions.push(recordButton);

    // === 2. CREATE THE PLAY BUTTON ===
    playButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    playButton.command = 'codereplay.startPlayback';
    playButton.text = `$(play) Play`;
    playButton.tooltip = 'Start Playback Session';
    playButton.show();
    context.subscriptions.push(playButton);

    // === 3. CREATE THE CLEANUP BUTTON ===
    cleanButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    cleanButton.command = 'codereplay.cleanPlaybackFiles';
    cleanButton.text = `$(trash) Clean`; // Uses the trash icon
    cleanButton.tooltip = 'Delete all (playback) files';
    cleanButton.show();
    context.subscriptions.push(cleanButton);

    // === 4. REGISTER THE COMMANDS ===

    // Start Recording Command
    const startRecordingCommand = vscode.commands.registerCommand('codereplay.startRecording', () => {
        eventLog = [];
        isRecording = true;
        fileSnapshots.clear();
        vscode.workspace.textDocuments.forEach(doc => {
            if (!doc.isUntitled && !doc.uri.fsPath.includes('(playback)')) {
                fileSnapshots.set(doc.uri.toString(), doc.getText());
            }
        });
        
        vscode.window.showInformationMessage('CodeReplay: Recording started!');
        recordButton.text = `$(debug-stop) Stop`;
        recordButton.command = 'codereplay.stopRecording';
        recordButton.tooltip = 'Stop Recording Session';
        playButton.hide();
        cleanButton.hide(); // Hide clean button while recording
    });

    // Stop Recording Command
    const stopRecordingCommand = vscode.commands.registerCommand('codereplay.stopRecording', () => {
        isRecording = false;
        vscode.window.showInformationMessage(`CodeReplay: Recording stopped. Captured ${eventLog.length} events.`);
        recordButton.text = `$(circle-filled) Record`;
        recordButton.command = 'codereplay.startRecording';
        recordButton.tooltip = 'Start Recording Session';
        playButton.show();
        cleanButton.show(); // Show buttons again
    });

    // Playback Command (Unchanged)
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
                const originalContent = fileSnapshots.get(event.file) || '';
                fs.writeFileSync(playbackPath, originalContent); 
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

    // NEW: Cleanup Command
    const cleanPlaybackCommand = vscode.commands.registerCommand('codereplay.cleanPlaybackFiles', async () => {
        // Find all files in the workspace ending with (playback).<any extension>
        const playbackFiles = await vscode.workspace.findFiles('**/*(playback).*');

        if (playbackFiles.length === 0) {
            vscode.window.showInformationMessage('CodeReplay: No playback files found to clean.');
            return;
        }

        // Ask for confirmation (this is a destructive action!)
        const choice = await vscode.window.showWarningMessage(
            `Are you sure you want to permanently delete ${playbackFiles.length} playback file(s)?`,
            { modal: true }, // Makes the popup block user input
            'Delete'
        );

        if (choice === 'Delete') {
            let deleteCount = 0;
            for (const fileUri of playbackFiles) {
                try {
                    // Use VS Code's filesystem API to delete
                    await vscode.workspace.fs.delete(fileUri);
                    deleteCount++;
                } catch (e) {
                    console.error(`Failed to delete ${fileUri.fsPath}`, e);
                    vscode.window.showErrorMessage(`Failed to delete file: ${fileUri.fsPath}`);
                }
            }
            vscode.window.showInformationMessage(`CodeReplay: Successfully deleted ${deleteCount} playback file(s).`);
        }
    });

    // Subscribe all commands
    context.subscriptions.push(
        startRecordingCommand, 
        stopRecordingCommand, 
        startPlaybackCommand,
        cleanPlaybackCommand // NEW
    );

    // === 5. EVENT LISTENERS (Unchanged logic, just small tweaks) ===
    vscode.workspace.onDidChangeTextDocument(event => {
        if (isRecording && event.contentChanges.length > 0 && !event.document.isUntitled) {
            if (event.document.uri.fsPath.includes('(playback)')) return;
            const fileUri = event.document.uri.toString();
            // Ensure snapshot exists if a file is edited before being "activated"
            if (!fileSnapshots.has(fileUri)) {
                fileSnapshots.set(fileUri, event.document.getText());
            }
            const timestamp = new Date().toISOString();
            for (const change of event.contentChanges) {
                eventLog.push({
                    type: 'edit', timestamp, file: fileUri,
                    range: { start: change.range.start, end: change.range.end },
                    text: change.text,
                    rangeLength: change.rangeLength
                });
            }
        }
    });

    vscode.window.onDidChangeActiveTextEditor(editor => {
        if (isRecording && editor && !editor.document.isUntitled) {
            if (editor.document.uri.fsPath.includes('(playback)')) return;
            const fileUri = editor.document.uri.toString();
            if (!fileSnapshots.has(fileUri)) {
                fileSnapshots.set(fileUri, editor.document.getText());
            }
            const timestamp = new Date().toISOString();
            eventLog.push({ type: 'switch_file', timestamp, file: fileUri });
        }
    });
}

export function deactivate() {
    // Dispose of all UI elements
    recordButton.dispose();
    playButton.dispose();
    cleanButton.dispose(); // NEW
}