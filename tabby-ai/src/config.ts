import { ConfigProvider } from 'tabby-core'

/** @hidden */
export class AIConfigProvider extends ConfigProvider {
    defaults = {
        ai: {
            enabled: true,
            provider: 'openai',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            model: 'gpt-4o-mini',
            availableModels: [],
            temperature: 0.1,
            maxContextChars: 16000,
            maxSteps: 8,
            stepTimeout: 60000,
            idleTimeout: 1200,
            permissionMode: 'approve',
            requireConfirmation: true,
            includeCurrentBuffer: true,
            systemPrompt: '',
        },
    }
}
