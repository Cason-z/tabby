import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import TabbyCoreModule, { ConfigProvider, TabContextMenuItemProvider } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import TabbyTerminalModule, { TerminalDecorator } from 'tabby-terminal'

import { AIConfigProvider } from './config'
import { AISettingsTabProvider } from './settings'
import { AISettingsTabComponent } from './components/aiSettingsTab.component'
import { AITakeoverModalComponent } from './components/aiTakeoverModal.component'
import { AITerminalContextMenu } from './tabContextMenu'
import { AITerminalMonitorService } from './services/aiTerminalMonitor.service'

/** @hidden */
@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        NgbModule,
        TabbyCoreModule,
        TabbyTerminalModule,
    ],
    providers: [
        { provide: ConfigProvider, useClass: AIConfigProvider, multi: true },
        { provide: SettingsTabProvider, useClass: AISettingsTabProvider, multi: true },
        { provide: TabContextMenuItemProvider, useClass: AITerminalContextMenu, multi: true },
        { provide: TerminalDecorator, useExisting: AITerminalMonitorService, multi: true },
    ],
    declarations: [
        AISettingsTabComponent,
        AITakeoverModalComponent,
    ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export default class AIModule { }
