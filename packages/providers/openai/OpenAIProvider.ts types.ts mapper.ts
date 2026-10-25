class OpenAIProvider implements LLMProvider {
  providerId = "openai";

  async generate(
    request: RamboRequest,
    model: string
  ) {}
}
