import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { AITerminalControllerService, AITakeoverHandle } from '../services/aiTerminalController.service'

interface LogLine {
    kind: 'status'|'command'|'output'|'error'|'done'
    text: string
}

/** @hidden */
@Component({
    templateUrl: './aiTakeoverModal.component.pug',
    styles: [require('./aiTakeoverModal.component.scss')],
})
export class AITakeoverModalComponent {
    @Input() terminal: BaseTerminalTabComponent<any>

    objective = ''
    running = false
    logs: LogLine[] = []
    private handle: AITakeoverHandle|null = null

    constructor (
        private activeModal: NgbActiveModal,
        private controller: AITerminalControllerService,
    ) { }

    start (): void {
        if (!this.objective.trim() || this.running) {
            return
        }
        this.logs = []
        this.running = true
        this.handle = this.controller.takeOver(this.terminal, this.objective.trim(), {
            step: text => this.add('status', text),
            command: text => this.add('command', text),
            output: text => this.add('output', text),
            done: text => {
                this.add('done', text)
                this.running = false
            },
            error: text => {
                this.add('error', text)
                this.running = false
            },
        })
        this.handle.done.catch(error => {
            this.add('error', error?.message ?? String(error))
            this.running = false
        })
    }

    stop (): void {
        this.handle?.cancel()
        this.running = false
        this.add('status', 'Stop requested')
    }

    close (): void {
        this.handle?.cancel()
        this.activeModal.close()
    }

    private add (kind: LogLine['kind'], text: string): void {
        this.logs = [...this.logs, { kind, text }]
    }
}
