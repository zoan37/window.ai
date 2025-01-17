import { v4 as uuidv4 } from "uuid"
import {
  type CompletionOptions,
  type InferredOutput,
  type Input,
  type ModelID,
  isMessagesInput,
  isPromptInput,
  isTextOutput
} from "window.ai"

import { BaseManager } from "./base"
import { configManager } from "./config"
import type { OriginData } from "./origin"
import { originManager } from "./origin"

export interface Transaction<TInput = Input> {
  id: string
  timestamp: number
  origin: OriginData
  input: Input
  numOutputs: number

  temperature?: number
  maxTokens?: number
  stopSequences?: string[]
  model?: ModelID | string
  routedModel?: ModelID | string

  outputs?: InferredOutput<TInput>[]
  error?: string
}

const originIndexName = "byOrigin"

class TransactionManager extends BaseManager<Transaction> {
  constructor() {
    super("transactions")
  }

  init<TInput extends Input>(
    input: TInput,
    origin: OriginData,
    options: CompletionOptions<ModelID | string, TInput>
  ): Transaction {
    this._validateInput(input)
    const {
      temperature,
      maxTokens,
      stopSequences,
      model,
      numOutputs = 1
    } = options
    return {
      id: uuidv4(),
      origin,
      timestamp: Date.now(),
      input,
      temperature,
      maxTokens,
      stopSequences,
      model,
      numOutputs
    }
  }

  // Override to set numOutputs on old data
  async _batchFetch(ids: string[]): Promise<Transaction[]> {
    return Promise.all(
      ids.map(async (id) => {
        const raw = await this.store.get<Transaction>(id)
        if (raw.numOutputs === undefined) {
          raw.numOutputs = 1
        }
        return raw
      })
    )
  }

  async save(txn: Transaction): Promise<boolean> {
    const isNew = await super.save(txn)

    if (isNew) {
      const originData = txn.origin
      const newOrigin = originManager.init(originData)
      const origin = await originManager.getOrInit(newOrigin.id, newOrigin)
      await Promise.all([
        originManager.save(origin),
        this.indexBy(txn, origin.id, originIndexName)
      ])
    }

    return isNew
  }

  getRoutedModel(txn: Transaction): ModelID | string | undefined {
    // Backward compat: use .model if routedModel undefined
    return txn.routedModel || txn.model
  }

  formatInput(txn: Transaction): string {
    if ("prompt" in txn.input) {
      return txn.input.prompt
    }
    return txn.input.messages.map((m) => `${m.role}: ${m.content}`).join("\n")
  }

  formatOutput(txn: Transaction): string | undefined {
    if (!txn.outputs) {
      return undefined
    }
    return txn.outputs
      .map((t) =>
        isTextOutput(t) ? t.text : `${t.message.role}: ${t.message.content}`
      )
      .join("\n")
  }

  formatJSON(txn: Transaction) {
    const { input, temperature, maxTokens, stopSequences, model, numOutputs } =
      txn
    return {
      input,
      temperature,
      maxTokens,
      stopSequences,
      model,
      numOutputs
    }
  }

  _validateInput(input: Input): void {
    if (
      typeof input !== "object" ||
      (!isPromptInput(input) && !isMessagesInput(input))
    ) {
      throw new Error("Invalid input")
    }
  }
}

export const transactionManager = new TransactionManager()
