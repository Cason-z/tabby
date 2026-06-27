export function stripTerminalSequences (text: string): string {
    return text
        .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1b[()][A-Za-z0-9]/g, '')
        .replace(/\r/g, '')
}

export function tailText (text: string, maxChars: number): string {
    if (text.length <= maxChars) {
        return text
    }
    return text.slice(text.length - maxChars)
}
