import { Component, HostBinding } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { AI_PROVIDER_PRESETS, AIProviderPreset, OpenAICompatibleService } from '../services/openAICompatible.service'

/** @hidden */
@Component({
    templateUrl: './aiSettingsTab.component.pug',
})
export class AISettingsTabComponent {
    @HostBinding('class.content-box') true

    providers = AI_PROVIDER_PRESETS
    loadingModels = false
    modelListError = ''

    constructor (
        public config: ConfigService,
        private llm: OpenAICompatibleService,
    ) { }

    applyProvider (): void {
        const preset = this.providers.find(x => x.id === this.config.store.ai.provider)
        if (preset && preset.id !== 'custom') {
            this.config.store.ai.baseUrl = preset.baseUrl
            this.config.store.ai.model = preset.defaultModel
        }
        this.config.store.ai.availableModels = []
        this.save()
    }

    async refreshModels (): Promise<void> {
        this.loadingModels = true
        this.modelListError = ''
        try {
            this.config.store.ai.availableModels = await this.llm.listModels()
            this.save()
        } catch (error) {
            this.modelListError = error?.message ?? String(error)
        } finally {
            this.loadingModels = false
        }
    }

    trackProvider (_index: number, provider: AIProviderPreset): string {
        return provider.id
    }

    save (): void {
        this.config.save()
    }
}
