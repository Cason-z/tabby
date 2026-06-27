import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'

export interface ChatMessage {
    role: 'system'|'user'|'assistant'
    content: string
}

export interface AIProviderPreset {
    id: string
    name: string
    baseUrl: string
    defaultModel: string
}

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
    { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o-mini' },
    { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: 'openai/gpt-4o-mini' },
    { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat' },
    { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-3.1-8b-instant' },
    { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo' },
    { id: 'siliconflow', name: 'SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', defaultModel: 'Qwen/Qwen2.5-7B-Instruct' },
    { id: 'moonshot', name: 'Moonshot', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k' },
    { id: 'dashscope', name: 'DashScope compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
    { id: 'custom', name: 'Custom OpenAI-compatible', baseUrl: '', defaultModel: '' },
]

/** @hidden */
@Injectable({ providedIn: 'root' })
export class OpenAICompatibleService {
    constructor (
        private config: ConfigService,
    ) { }

    async completeJSON (messages: ChatMessage[]): Promise<any> {
        const content = await this.complete(messages, true).catch(async error => {
            if (this.shouldRetryWithoutJSONMode(error)) {
                return this.complete(messages, false)
            }
            throw error
        })
        return this.parseJSON(content)
    }

    async listModels (): Promise<string[]> {
        const response = await fetch(`${this.getBaseUrl()}/models`, {
            method: 'GET',
            headers: this.getHeaders(),
        })
        const text = await response.text()
        if (!response.ok) {
            throw new Error(`AI model list failed: HTTP ${response.status} ${text}`)
        }
        const payload = JSON.parse(text)
        return (payload?.data ?? [])
            .map((model: any) => model?.id)
            .filter((id: any): id is string => typeof id === 'string')
            .sort()
    }

    private async complete (messages: ChatMessage[], jsonMode: boolean): Promise<string> {
        const aiConfig = this.config.store.ai
        const model = aiConfig.model

        if (!model) {
            throw new Error('AI model is not configured')
        }

        const body: any = {
            model,
            messages,
            temperature: aiConfig.temperature,
        }
        if (jsonMode) {
            body.response_format = { type: 'json_object' }
        }

        const response = await fetch(`${this.getBaseUrl()}/chat/completions`, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify(body),
        })

        const text = await response.text()
        if (!response.ok) {
            const error: any = new Error(`AI request failed: HTTP ${response.status}`)
            error.status = response.status
            error.body = text
            throw error
        }

        const payload = JSON.parse(text)
        const content = payload?.choices?.[0]?.message?.content
        if (!content) {
            throw new Error('AI response did not include message content')
        }
        return content
    }

    private getBaseUrl (): string {
        const baseUrl = (this.config.store.ai.baseUrl ?? '').replace(/\/+$/, '')
        if (!baseUrl) {
            throw new Error('AI base URL is not configured')
        }
        return baseUrl
    }

    private getHeaders (): Record<string, string> {
        const configuredApiKey = this.config.store.ai.apiKey
        const apiKey = configuredApiKey ? configuredApiKey : process.env.OPENAI_API_KEY ?? ''
        if (!apiKey) {
            throw new Error('AI API key is not configured')
        }
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        }
    }

    private shouldRetryWithoutJSONMode (error: any): boolean {
        const status = error?.status
        const body = String(error?.body ?? '')
        return status === 400 && /response_format|json/i.test(body)
    }

    private parseJSON (content: string): any {
        try {
            return JSON.parse(content)
        } catch {
            const start = content.indexOf('{')
            const end = content.lastIndexOf('}')
            if (start >= 0 && end > start) {
                return JSON.parse(content.slice(start, end + 1))
            }
            throw new Error('AI response was not valid JSON')
        }
    }
}
