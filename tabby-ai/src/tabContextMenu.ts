import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { BaseTabComponent, ConfigService, MenuItemOptions, TabContextMenuItemProvider } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { AITakeoverModalComponent } from './components/aiTakeoverModal.component'

/** @hidden */
@Injectable()
export class AITerminalContextMenu extends TabContextMenuItemProvider {
    weight = 2

    constructor (
        private config: ConfigService,
        private ngbModal: NgbModal,
    ) {
        super()
    }

    async getItems (tab: BaseTabComponent): Promise<MenuItemOptions[]> {
        if (!this.config.store.ai?.enabled || !(tab instanceof BaseTerminalTabComponent)) {
            return []
        }
        return [{
            label: 'AI take over terminal',
            click: () => {
                const modal = this.ngbModal.open(AITakeoverModalComponent, { size: 'lg' })
                modal.componentInstance.terminal = tab
            },
        }]
    }
}
