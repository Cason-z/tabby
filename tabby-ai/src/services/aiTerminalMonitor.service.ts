import { Injectable } from '@angular/core'
import { BaseTerminalTabComponent, TerminalDecorator } from 'tabby-terminal'
import { stripTerminalSequences, tailText } from './text'

const MAX_BUFFER_CHARS = 200000

/** @hidden */
@Injectable({ providedIn: 'root' })
export class AITerminalMonitorService extends TerminalDecorator {
    private buffers = new WeakMap<BaseTerminalTabComponent<any>, string>()

    attach (terminal: BaseTerminalTabComponent<any>): void {
        const subscription = terminal.output$.subscribe(data => {
            const next = tailText((this.buffers.get(terminal) ?? '') + data, MAX_BUFFER_CHARS)
            this.buffers.set(terminal, next)
        })
        this.subscribeUntilDetached(terminal, subscription)
    }

    getText (terminal: BaseTerminalTabComponent<any>, maxChars: number): string {
        const liveText = this.getFrontendText(terminal)
        const streamText = this.buffers.get(terminal) ?? ''
        return tailText(stripTerminalSequences(liveText || streamText), maxChars)
    }

    private getFrontendText (terminal: BaseTerminalTabComponent<any>): string {
        try {
            return terminal.frontend.saveState?.() ?? ''
        } catch {
            return ''
        }
    }
}
