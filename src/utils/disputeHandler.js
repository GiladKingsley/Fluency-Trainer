// Dispute handling utility for ZipfTrainer
// Handles AI-based dispute resolution for ambiguous answers

import { callGeminiWithFallback } from './geminiApi';
/**
 * Generates dispute resolution prompts for different training modes
 */
const getDisputePrompt = (mode, context) => {
  const basePrompt = `You are evaluating whether a user's answer should be considered correct despite initially being marked wrong. Be generous but fair - if the user's answer demonstrates understanding of the word's meaning in the given context, it should be accepted, if the word doesn't fit some of the context, for example if it fits only one of the sentences or definitions, it should be rejected.

Respond with exactly this format:
DECISION: [ACCEPT or REJECT]
EXPLANATION: [One sentence explaining your decision]`;

  switch (mode) {
    case 'normal':
      return `${basePrompt}

Context: The user was given cloze test sentences with blanks to fill in:
"${context.clozeTest}"

ORIGINAL SENTENCES (with correct word):
"${context.originalSentences}"

SENTENCES WITH USER'S WORD:
"${context.userSentences}"

The CORRECT WORD is: "${context.correctAnswer}"
The user answered: "${context.userAnswer}"

Additional context provided to user: ${context.helpContent || 'None'}

Consider whether the user's answer should be accepted by evaluating:
- Does the user's answer fit grammatically and semantically in both sentences?
- Is it a synonym, alternative form, or closely related word to "${context.correctAnswer}"?
- Does it demonstrate understanding of the intended meaning, even if not the exact target word?
- Would a reasonable person consider "${context.userAnswer}" a valid alternative to "${context.correctAnswer}" in these contexts?

Remember: The word must work well in ALL provided sentences to be accepted.`;

    case 'definition':
      return `${basePrompt}

Context: The user was given this definition and asked to identify the word:
"${context.definition}"

The CORRECT WORD is: "${context.correctAnswer}"
The user answered: "${context.userAnswer}"

Additional context provided to user: ${context.helpContent || 'None'}

Consider whether the user's answer should be accepted by evaluating:
- Does the user's answer match or fit the given definition?
- Is it a synonym, alternative term, or closely related word to "${context.correctAnswer}"?
- Does it demonstrate understanding of the concept described in the definition?
- Could "${context.userAnswer}" reasonably be considered a valid answer for the definition, even if "${context.correctAnswer}" was the target?`;

    case 'combo':
      return `${basePrompt}

Context: The user was given this combined content:
${context.comboContent}

The CORRECT WORD is: "${context.correctAnswer}"
The user answered: "${context.userAnswer}"

Consider whether the user's answer should be accepted by evaluating:
- Does the user's answer fit any of the provided contexts (definition, examples, or usage)?
- Is it a synonym, alternative form, or closely related word to "${context.correctAnswer}"?
- Does it demonstrate understanding of the word's meaning from the given information?
- Would "${context.userAnswer}" be a reasonable interpretation of the provided content, even if "${context.correctAnswer}" was the target?`;

    default:
      return `${basePrompt}

The CORRECT WORD is: "${context.correctAnswer}"
The user answered: "${context.userAnswer}"
Context: ${JSON.stringify(context)}

Consider whether "${context.userAnswer}" should be accepted as a valid alternative to "${context.correctAnswer}" based on the provided context.`;
  }
};

/**
 * Calls Gemini API to resolve disputes with retry logic
 */
export const resolveDispute = async (apiKey, mode, context) => {
  if (!apiKey) {
    throw new Error('Gemini API key is required for dispute resolution');
  }

  const prompt = getDisputePrompt(mode, context);
  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    try {
      const requestBody = {
        contents: [{
          parts: [{
            text: prompt
          }]
        }]
      };

      const response = await callGeminiWithFallback(apiKey, 'gemini-2.5-flash', requestBody);
      const result = response.text;

      // Parse the response format: DECISION: [ACCEPT/REJECT]\nEXPLANATION: [explanation]
      const decisionMatch = result.match(/DECISION:\s*(ACCEPT|REJECT)/i);
      const explanationMatch = result.match(/EXPLANATION:\s*(.+)/i);

      const decision = decisionMatch ? decisionMatch[1].toUpperCase() === 'ACCEPT' : false;
      const explanation = explanationMatch ? explanationMatch[1].trim() : 'No explanation provided.';

      return {
        accepted: decision,
        explanation: explanation
      };
    } catch (error) {
      attempts++;
      console.error(`Dispute resolution attempt ${attempts} failed:`, error);
      
      if (attempts === maxAttempts) {
        console.error('Dispute resolution failed after', maxAttempts, 'attempts');
        throw error;
      }
      
      // Add a small delay between retries (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
    }
  }
};

/**
 * Prepares context object for different modes
 */
export const prepareDisputeContext = (mode, state) => {
  switch (mode) {
    case 'normal':
      // Create sentences with both the correct word and user's word for comparison
      const clozeText = typeof state.clozeTest === 'string' ? state.clozeTest : '';
      const normalCorrectWord = state.currentWord?.word || state.currentWord || '';
      const normalUserWord = state.userAnswer || '';
      
      const originalSentences = clozeText ? clozeText.replace(/_+/g, normalCorrectWord) : '';
      const userSentences = clozeText ? clozeText.replace(/_+/g, normalUserWord) : '';
      
      return {
        clozeTest: clozeText,
        originalSentences: originalSentences,
        userSentences: userSentences,
        correctAnswer: normalCorrectWord,
        userAnswer: normalUserWord,
        helpContent: state.helpContent
      };

    case 'definition':
      return {
        definition: typeof state.wordDefinition === 'object' ? state.wordDefinition.definition : state.wordDefinition,
        correctAnswer: state.currentWord?.word || state.currentWord,
        userAnswer: state.userGuess,
        helpContent: state.helpContent
      };

    case 'combo':
      const comboCorrectWord = state.currentWord?.word || state.currentWord || '';
      const comboUserWord = state.userComboAnswer || '';
      
      let formattedContent = '';
      let originalSentence = '';
      let userSentence = '';
      
      if (typeof state.comboContent === 'object' && state.comboContent) {
        // Extract definition part
        const definitionPart = `Definition:\n${state.comboContent.partOfSpeech ? `${state.comboContent.partOfSpeech}\n` : ''}${state.comboContent.definition}`;
        
        // Handle sentence with blanks
        const sentenceText = state.comboContent.sentence || '';
        originalSentence = sentenceText ? sentenceText.replace(/_+/g, comboCorrectWord) : '';
        userSentence = sentenceText ? sentenceText.replace(/_+/g, comboUserWord) : '';
        
        formattedContent = `${definitionPart}\n\nOriginal Context:\n"${originalSentence}"\n\nContext with User's Word:\n"${userSentence}"`;
      } else {
        formattedContent = state.comboContent || '';
      }
      
      return {
        comboContent: formattedContent,
        correctAnswer: comboCorrectWord,
        userAnswer: comboUserWord,
      };

    default:
      return {
        correctAnswer: state.currentWord?.word || state.currentWord,
        userAnswer: state.userAnswer || state.userGuess,
        mode: mode
      };
  }
};