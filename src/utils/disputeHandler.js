// Dispute handling utility for ZipfTrainer
// Handles AI-based dispute resolution for ambiguous answers

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
/**
 * Generates dispute resolution prompts for different training modes
 */
const getDisputePrompt = (mode, context) => {
  const basePrompt = `You are evaluating whether a user's answer should be considered correct despite initially being marked wrong. Be generous but fair - if the user's answer demonstrates understanding of the word's meaning in the given context, it should be accepted.

Respond with exactly this format:
DECISION: [ACCEPT or REJECT]
EXPLANATION: [One sentence explaining your decision]`;

  switch (mode) {
    case 'normal':
      return `${basePrompt}

Context: The user was given this cloze test sentence with a blank to fill in:
"${context.clozeTest}"

The correct answer was: "${context.correctAnswer}"
The user answered: "${context.userAnswer}"

Additional context provided to user: ${context.helpContent || 'None'}

Consider:
- Does the user's answer fit grammatically and semantically in the sentence?
- Is it a valid alternative word that makes sense in this context?
- Does it demonstrate understanding of the intended meaning?`;

    case 'definition':
      return `${basePrompt}

Context: The user was given this definition and asked to identify the word:
"${context.definition}"

The correct answer was: "${context.correctAnswer}"
The user answered: "${context.userAnswer}"

Additional context provided to user: ${context.helpContent || 'None'}

Consider:
- Does the user's answer match the given definition?
- Is it a synonym or closely related word that fits the definition?
- Does it demonstrate understanding of the concept described?`;

    case 'combo':
      return `${basePrompt}

Context: The user was given this combined content:
${context.comboContent}

The correct answer was: "${context.correctAnswer}"
The user answered: "${context.userAnswer}"

Consider:
- Does the user's answer fit any of the provided contexts (definition, examples, or usage)?
- Is it a valid interpretation of the given information?
- Does it demonstrate understanding of the word's meaning?`;

    default:
      return `${basePrompt}

The user answered: "${context.userAnswer}"
The correct answer was: "${context.correctAnswer}"
Context: ${JSON.stringify(context)}

Please evaluate if the user's answer should be accepted.`;
  }
};

/**
 * Calls Gemini API to resolve disputes
 */
export const resolveDispute = async (apiKey, mode, context) => {
  if (!apiKey) {
    throw new Error('Gemini API key is required for dispute resolution');
  }

  const prompt = getDisputePrompt(mode, context);

  try {
    const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 100,
        }
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    const result = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

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
    console.error('Dispute resolution failed:', error);
    throw error;
  }
};

/**
 * Prepares context object for different modes
 */
export const prepareDisputeContext = (mode, state) => {
  switch (mode) {
    case 'normal':
      return {
        clozeTest: state.clozeTest,
        correctAnswer: state.currentWord?.word,
        userAnswer: state.userAnswer,
        helpContent: state.helpContent
      };

    case 'definition':
      return {
        definition: state.wordDefinition,
        correctAnswer: state.currentWord?.word,
        userAnswer: state.userGuess,
        helpContent: state.helpContent
      };

    case 'combo':
      return {
        comboContent: state.comboContent,
        correctAnswer: state.currentWord?.word,
        userAnswer: state.userComboAnswer,
      };

    default:
      return {
        correctAnswer: state.currentWord?.word,
        userAnswer: state.userAnswer || state.userGuess,
        mode: mode
      };
  }
};