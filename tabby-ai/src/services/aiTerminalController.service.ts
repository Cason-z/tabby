import { Injectable } from '@angular/core'
import { ConfigService, PlatformService } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { AITerminalMonitorService } from './aiTerminalMonitor.service'
import { OpenAICompatibleService, ChatMessage } from './openAICompatible.service'
import { AITabbyToolsService, AITabbyToolAction } from './aiTabbyTools.service'
import { stripTerminalSequences, tailText } from './text'

export interface AITakeoverCallbacks {
    step: (message: string) => void
    command: (command: string) => void
    output: (output: string) => void
    done: (summary: string) => void
    error: (message: string) => void
}

export interface AITakeoverHandle {
    cancel: () => void
    done: Promise<void>
}

interface AIAction extends AITabbyToolAction {
    command?: string
    done?: boolean
    summary?: string
}

/** @hidden */
@Injectable({ providedIn: 'root' })
export class AITerminalControllerService {
    constructor (
        private config: ConfigService,
        private platform: PlatformService,
        private monitor: AITerminalMonitorService,
        private llm: OpenAICompatibleService,
        private tabbyTools: AITabbyToolsService,
    ) { }

    takeOver (
        terminal: BaseTerminalTabComponent<any>,
        objective: string,
        callbacks: AITakeoverCallbacks,
    ): AITakeoverHandle {
        let cancelled = false
        const done = this.run(terminal, objective, callbacks, () => cancelled)
        return {
            cancel: () => { cancelled = true },
            done,
        }
    }

    private async run (
        terminal: BaseTerminalTabComponent<any>,
        objective: string,
        callbacks: AITakeoverCallbacks,
        isCancelled: () => boolean,
    ): Promise<void> {
        const aiConfig = this.config.store.ai
        const transcript: ChatMessage[] = []
        const maxSteps = Math.max(1, aiConfig.maxSteps || 1)
        let activeTerminal = terminal

        for (let step = 1; step <= maxSteps; step++) {
            if (isCancelled()) {
                callbacks.done('AI takeover stopped')
                return
            }

            callbacks.step(`Step ${step}/${maxSteps}: asking model`)
            const context = this.monitor.getText(activeTerminal, aiConfig.maxContextChars)
            const action = await this.askModel(objective, context, transcript)

            if (action.done) {
                callbacks.done(action.summary || 'Done')
                return
            }

            if (this.tabbyTools.isToolAction(action)) {
                const actionLabel = this.tabbyTools.describeAction(action)
                callbacks.command(actionLabel)
                if (
                    this.getPermissionMode() === 'approve' &&
                    this.tabbyTools.isMutatingAction(action) &&
                    !await this.confirmTool(actionLabel, action.reason)
                ) {
                    callbacks.done('Action rejected by user')
                    return
                }
                const result = await this.tabbyTools.execute(action, activeTerminal)
                if (result.terminal) {
                    activeTerminal = result.terminal
                }
                await new Promise(resolve => setTimeout(resolve, 1200))
                transcript.push({
                    role: 'assistant',
                    content: JSON.stringify(action),
                })
                transcript.push({
                    role: 'user',
                    content: `Tabby action result:\n${tailText(result.message, aiConfig.maxContextChars)}`,
                })
                callbacks.output(result.message)
                continue
            }

            const command = this.normalizeCommand(action.command)
            if (!command) {
                callbacks.done(action.summary || action.reason || 'Model returned no command')
                return
            }

            callbacks.command(command)
            if (this.getPermissionMode() === 'approve' && !await this.confirmCommand(command, action.reason)) {
                callbacks.done('Command rejected by user')
                return
            }

            callbacks.step('Executing command')
            const result = await this.executeCommand(activeTerminal, command, isCancelled)
            callbacks.output(result.output || '(no output)')
            transcript.push({
                role: 'assistant',
                content: JSON.stringify(action),
            })
            transcript.push({
                role: 'user',
                content: `Command output:\n${tailText(result.output, aiConfig.maxContextChars)}`,
            })

            if (!result.completed) {
                callbacks.error(result.error || 'Command did not complete before timeout')
                return
            }
        }

        callbacks.done('Stopped after max steps')
    }

    private async askModel (objective: string, context: string, transcript: ChatMessage[]): Promise<AIAction> {
        const customPrompt = this.config.store.ai.systemPrompt
        const system = customPrompt || [
            'You are an AI terminal operator embedded in Tabby.',
            'You control an existing interactive terminal session by proposing exactly one tool action per step.',
            'Use {"action":"terminalCommand","reason":"short reason","command":"single-line command","done":false} to run one command in the active terminal.',
            'Use {"action":"openSSH","reason":"short reason","ssh":{"query":"user@host:22"},"done":false} to ask Tabby to create and connect a new SSH tab.',
            'Use {"action":"quickConnect","query":"ssh://user@host:22","protocol":"auto"} to open SSH, telnet, socket, or serial targets.',
            'Use {"action":"listSessions"} and {"action":"getTerminalBuffer","sessionId":"..."} to inspect existing terminal sessions.',
            'Use {"action":"sendInput","sessionId":"...","input":"text","enter":true} for interactive prompts.',
            'Use {"action":"listTabs"}, {"action":"selectTab","tabIndex":0}, or {"action":"closeTab","tabIndex":0} for Tabby tabs.',
            'Use {"action":"listProfiles"} and {"action":"openProfile","profileId":"..."} for saved Tabby profiles.',
            'Use SFTP actions on active SSH sessions: sftpList, sftpRead, sftpWrite, sftpMkdir, sftpDelete, sftpRename, sftpStat.',
            'SFTP examples: {"action":"sftpRead","path":"/etc/hosts"} or {"action":"sftpWrite","path":"/tmp/a.txt","content":"hello"}.',
            'For SSH, query may be host, user@host, host:port, or user@host:port.',
            'Prefer read-only inspection first. Avoid destructive operations unless the user objective explicitly requires them.',
            'Never request or print secrets. Do not exfiltrate private keys, tokens, cookies, or passwords.',
            'Use non-interactive commands when possible. Avoid editors, pagers, full-screen TUI programs, and commands that wait forever.',
            'Commands must be a single line. Do not include newlines, terminal control characters, or hidden follow-up commands.',
            'When the task is complete, return {"done":true,"summary":"what changed or what you found"}.',
        ].join('\n')

        return await this.llm.completeJSON([
            { role: 'system', content: system },
            {
                role: 'user',
                content: [
                    `Objective:\n${objective}`,
                    `Recent terminal context:\n${context || '(empty)'}`,
                ].join('\n\n'),
            },
            ...transcript.slice(-12),
        ])
    }

    private normalizeCommand (command?: string): string {
        const normalized = (command ?? '').trim()
        if (/[\r\n]/.test(normalized)) {
            throw new Error('AI returned a multi-line command; refusing to run it')
        }
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(normalized)) {
            throw new Error('AI returned a command with terminal control characters; refusing to run it')
        }
        return normalized
    }

    private async confirmTool (label: string, reason?: string): Promise<boolean> {
        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: 'Allow AI to run this Tabby action?',
            detail: `${reason ? `${reason}\n\n` : ''}${label}`,
            buttons: ['Run', 'Stop'],
            defaultId: 0,
            cancelId: 1,
        })
        return result.response === 0
    }

    private getPermissionMode (): 'approve'|'fullAccess' {
        const aiConfig = this.config.store.ai
        if (aiConfig.permissionMode === 'approve' || aiConfig.permissionMode === 'fullAccess') {
            return aiConfig.permissionMode
        }
        return aiConfig.requireConfirmation === false ? 'fullAccess' : 'approve'
    }

    private async confirmCommand (command: string, reason?: string): Promise<boolean> {
        const result = await this.platform.showMessageBox({
            type: 'warning',
            message: 'Allow AI to run this command?',
            detail: `${reason ? `${reason}\n\n` : ''}${command}`,
            buttons: ['Run', 'Stop'],
            defaultId: 0,
            cancelId: 1,
        })
        return result.response === 0
    }

    private async executeCommand (
        terminal: BaseTerminalTabComponent<any>,
        command: string,
        isCancelled: () => boolean,
    ): Promise<{ completed: boolean, output: string, error?: string }> {
        const timeout = this.config.store.ai.stepTimeout || 60000
        const doneMarker = `__TABBY_AI_DONE_${Math.random().toString(16).slice(2)}__`
        let output = ''

        const subscription = terminal.output$.subscribe(data => {
            output += data
        })

        try {
            terminal.sendInput(`${command}\recho ${doneMarker}\r`)
            const startedAt = Date.now()
            while (Date.now() - startedAt < timeout) {
                if (isCancelled()) {
                    terminal.sendInput('\x03')
                    return { completed: false, output: this.cleanOutput(output), error: 'Cancelled' }
                }
                if (output.includes(doneMarker)) {
                    return { completed: true, output: this.cleanOutput(this.removeDoneMarker(output, doneMarker)) }
                }
                await new Promise(resolve => setTimeout(resolve, 100))
            }
            return {
                completed: false,
                output: this.cleanOutput(output),
                error: 'Timed out waiting for command completion marker',
            }
        } finally {
            subscription.unsubscribe()
        }
    }

    private cleanOutput (output: string): string {
        return stripTerminalSequences(output).trim()
    }

    private removeDoneMarker (output: string, doneMarker: string): string {
        return output
            .split(/\r?\n/g)
            .filter(line => !line.includes(doneMarker))
            .join('\n')
    }
}
