import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'
import { AISettingsTabComponent } from './components/aiSettingsTab.component'

/** @hidden */
@Injectable()
export class AISettingsTabProvider extends SettingsTabProvider {
    id = 'ai'
    icon = 'robot'
    title = 'AI'
    weight = 50

    getComponentType (): any {
        return AISettingsTabComponent
    }
}
