import React, { useState, useEffect, useCallback, useRef } from 'react';
import { resolveDispute, prepareDisputeContext } from '../utils/disputeHandler';
import { callGeminiWithFallback } from '../utils/geminiApi';
//please work lol
const ZIPF_ADJUSTMENT = 0.05;
const ZIPF_RANGE = 0.1;
const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb'];

// Simple Levenshtein distance for fuzzy matching
const levenshteinDistance = (str1, str2) => {
  const matrix = [];
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[str2.length][str1.length];
};

const getInitialState = () => {
  const savedZipfLevels = localStorage.getItem('zipfLevels');
  const savedMode = localStorage.getItem('trainingMode');
  const savedGeminiKey = localStorage.getItem('geminiApiKey');
  const savedReverseZipfLevel = localStorage.getItem('reverseZipfLevel');
  const savedNormalZipfLevel = localStorage.getItem('normalZipfLevel');
  const savedDefinitionZipfLevel = localStorage.getItem('definitionZipfLevel');
  const savedComboZipfLevel = localStorage.getItem('comboZipfLevel');
  const savedRecentWords = localStorage.getItem('recentWords');

  return {
    zipfLevels: savedZipfLevels
      ? JSON.parse(savedZipfLevels)
      : {
          default: 5.0,
        },
    trainingMode: savedMode || 'normal',
    geminiApiKey: savedGeminiKey || '',
    reverseZipfLevel: savedReverseZipfLevel ? parseFloat(savedReverseZipfLevel) : 5.0,
    normalZipfLevel: savedNormalZipfLevel ? parseFloat(savedNormalZipfLevel) : 5.0,
    definitionZipfLevel: savedDefinitionZipfLevel ? parseFloat(savedDefinitionZipfLevel) : 5.0,
    comboZipfLevel: savedComboZipfLevel ? parseFloat(savedComboZipfLevel) : 5.0,
    recentWords: savedRecentWords ? JSON.parse(savedRecentWords) : [],
  };
};

const ZipfTrainer = ({ isDarkMode, setIsDarkMode }) => {
  const [wordData, setWordData] = useState(null);
  const [currentWord, setCurrentWord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAnswer, setShowAnswer] = useState(false);
  const [nameData, setNameData] = useState(new Set());

  // Get initial state from localStorage or defaults
  const {
    zipfLevels: initialZipfLevels,
    trainingMode: initialMode,
    geminiApiKey: initialGeminiKey,
    reverseZipfLevel: initialReverseZipfLevel,
    normalZipfLevel: initialNormalZipfLevel,
    definitionZipfLevel: initialDefinitionZipfLevel,
    comboZipfLevel: initialComboZipfLevel,
    recentWords: initialRecentWords,
  } = getInitialState();
  const [zipfLevels, setZipfLevels] = useState(initialZipfLevels);
  const [trainingMode, setTrainingMode] = useState(initialMode);
  const [geminiApiKey, setGeminiApiKey] = useState(initialGeminiKey);
  const [recentWords, setRecentWords] = useState(initialRecentWords);
  
  // Normal mode state (cloze test)
  const [clozeTest, setClozeTest] = useState('');
  const [userAnswer, setUserAnswer] = useState('');
  const [normalZipfLevel, setNormalZipfLevel] = useState(initialNormalZipfLevel);
  const [generatingCloze, setGeneratingCloze] = useState(false);
  const [normalScore, setNormalScore] = useState(null);
  
  // Reverse mode state
  const [userDefinition, setUserDefinition] = useState('');
  const [score, setScore] = useState(null);
  const [correctDefinition, setCorrectDefinition] = useState('');
  const [grading, setGrading] = useState(false);
  const [reverseZipfLevel, setReverseZipfLevel] = useState(initialReverseZipfLevel);

  // Definition mode state
  const [wordDefinition, setWordDefinition] = useState('');
  const [userGuess, setUserGuess] = useState('');
  const [definitionZipfLevel, setDefinitionZipfLevel] = useState(initialDefinitionZipfLevel);
  const [generatingDefinition, setGeneratingDefinition] = useState(false);
  const [definitionScore, setDefinitionScore] = useState(null);

  // Help functionality state
  const [helpUsed, setHelpUsed] = useState(false);
  const [helpContent, setHelpContent] = useState(null);
  const [generatingHelp, setGeneratingHelp] = useState(false);

  // Combo mode state
  const [comboContent, setComboContent] = useState(null);
  const [userComboAnswer, setUserComboAnswer] = useState('');
  const [comboZipfLevel, setComboZipfLevel] = useState(initialComboZipfLevel);
  const [generatingCombo, setGeneratingCombo] = useState(false);
  const [comboScore, setComboScore] = useState(null);

  // API Key modal state
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  
  // Welcome modal state
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);

  // Dispute functionality state
  const [disputeInProgress, setDisputeInProgress] = useState(false);
  const [disputeResolved, setDisputeResolved] = useState(false);
  const [disputeResult, setDisputeResult] = useState(null); // { accepted: boolean, explanation: string }
  const [disputeError, setDisputeError] = useState(null);

  const normalModeInputRef = useRef(null);
  const reverseModeInputRef = useRef(null);
  const definitionModeInputRef = useRef(null);
  const comboModeInputRef = useRef(null);

  // Function to check if a word is a name
  const isName = useCallback((word) => {
    return nameData.has(word.toLowerCase());
  }, [nameData]);

  // Check if user answer matches target word (with typo tolerance)
  const isAnswerCorrect = useCallback((userInput, targetWord) => {
    if (!userInput || !targetWord) return false;
    const normalizedUser = userInput.toLowerCase().trim();
    const normalizedTarget = targetWord.toLowerCase();
    
    // Exact match
    if (normalizedUser === normalizedTarget) return true;
    
    // Allow 1 character difference for words 4+ letters
    // Allow 2 character difference for words 8+ letters
    const maxDistance = targetWord.length >= 8 ? 2 : targetWord.length >= 4 ? 1 : 0;
    return levenshteinDistance(normalizedUser, normalizedTarget) <= maxDistance;
  }, []);

  const getWordsInZipfRange = useCallback((zipfLevel) => {
    if (!wordData) return [];

    const targetZipf = zipfLevel;
    const minZipf = targetZipf - ZIPF_RANGE / 2;
    const maxZipf = targetZipf + ZIPF_RANGE / 2;

    return Object.entries(wordData)
      .filter(
        ([_, data]) => data.zipf >= minZipf && data.zipf <= maxZipf,
      )
      .map(([word]) => word);
  }, [wordData]);

  // Weighted random selection that heavily avoids recent words
  const selectWordWithWeighting = useCallback((wordsInRange) => {
    if (!wordsInRange || wordsInRange.length === 0) return null;
    
    // If we have very few words, fall back to pure random to avoid endless repetition
    if (wordsInRange.length <= 5) {
      return wordsInRange[Math.floor(Math.random() * wordsInRange.length)];
    }
    
    // Create weighted array: recent words get weight 1, others get weight 20
    const weights = wordsInRange.map(word => 
      recentWords.includes(word) ? 1 : 20
    );
    
    // Calculate total weight
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    
    // Select random point in weight distribution
    let random = Math.random() * totalWeight;
    
    // Find the word at this weight point
    for (let i = 0; i < wordsInRange.length; i++) {
      random -= weights[i];
      if (random <= 0) {
        return wordsInRange[i];
      }
    }
    
    // Fallback (shouldn't happen)
    return wordsInRange[wordsInRange.length - 1];
  }, [recentWords]);

  // Add word to recent words tracking (maintain max 35 recent words)
  const addToRecentWords = useCallback((word) => {
    setRecentWords(prev => {
      const updated = [word, ...prev.filter(w => w !== word)];
      return updated.slice(0, 35); // Keep only the 35 most recent
    });
  }, []);

  const generateClozeTest = useCallback(async (word) => {
    if (!geminiApiKey) {
      return null;
    }

    setGeneratingCloze(true);
    
    try {
      const requestBody = {
        contents: [{
          parts: [{
            text: `You are an AI that creates high-quality cloze-test exercises for a given English word. Your purpose is to help adults train their language fluency by testing the same word in different contexts.

You will be given a word in \`<word>\` tags. Your response must follow these strict rules:

**1. Valid Word Handling:**
- For any valid English word, you must create exactly TWO separate sentences, each showing the target word in a different context.
- Each sentence must be enclosed in its own \`<sentence1>\` and \`<sentence2>\` tags.
- In each sentence, include the target word naturally in its proper location.
- The two sentences should demonstrate different meanings, uses, or contexts of the same word.

**2. Invalid Word Handling:**
- If the input is not a real English word, your entire output must be the exact text \`NOT_A_WORD\`.
- Do not use any tags for this output.
- Invalid words include:
    - Numbers
    - Random character combinations (e.g., "pvzr")
    - Malformed words or typos (e.g., "thing's", "w8")
    - Most personal names or obscure trademarks (e.g., "Isabella", "Noah")
    - Most places
- **Exception:** You may treat widely known place names with cultural significance as valid words (e.g., "hollywood", "paris").

**3. Sentence Quality Requirements:**
- **A. Two distinct contexts:** Each sentence should show the word in a meaningfully different context or usage. The more different, the better.

- **B. Extreme Unambiguity:** The context of each sentence must be so specific that it points to the target word and *only* the target word. There should be zero room for synonyms or other plausible words. This is the most important rule.
    - **Pristine Example:** For the word "crane".
        \`<sentence1>Identifiable by its long legs, slender neck, and a distinctive red patch of skin on its forehead, the Sandhill crane performed its elaborate courtship dance in the open prairie, a behavior unique to this large bird.</sentence1>
        <sentence2>The dockworker skillfully operated the towering port crane, using its powerful hydraulic arm and cable system to lift a 40-foot shipping container from the cargo ship and place it precisely onto the waiting truck chassis.</sentence2>\`
    - **Reasoning:** This example is perfect because the specific details in each sentence (like "Sandhill" and "courtship dance" for the bird; and "port" and "shipping container" for the machine) eliminate all possible synonyms. No other word but "crane" fits both of these hyper-specific descriptions.

- **C. Strategic Use of Two Sentences:** Consciously use the fact that you are providing two sentences for the same word. By making the two contexts maximally different (e.g., biology vs. industrial machinery; a concrete object vs. an abstract concept), you create a powerful meta-clue that forces the user to find the single, specific word that can bridge those two disparate worlds.

- **D. Exact Match:** The target word should appear *exactly* as provided in the original word (e.g. if the word is "my" then do not use the word "mine" as suuficiently close).

- **E. Longer and Descriptive:** Each sentence should be substantial (generally 15-30 words) and packed with descriptive details that help enforce the "Extreme Unambiguity" rule.

- **F. Independent:** Each sentence should be completely independent and understandable on its own, without relying on the other.

- **G. No Markdown formatting** 

<word>${word}</word>`
          }]
        }]
      };

      const response = await callGeminiWithFallback(geminiApiKey, 'gemini-2.5-flash-lite-preview-06-17', requestBody);
      const text = response.text;
      
      if (text === 'NOT_A_WORD') {
        return 'NOT_A_WORD';
      }
      
      // Extract sentences from tags
      const sentence1Match = text.match(/<sentence1>(.*?)<\/sentence1>/s);
      const sentence2Match = text.match(/<sentence2>(.*?)<\/sentence2>/s);
      
      if (sentence1Match && sentence2Match) {
        // Replace the target word with underscores in both sentences
        const createClozeVersion = (sentence, targetWord) => {
          // Create regex to match the word with word boundaries, case insensitive
          const regex = new RegExp(`\\b${targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
          return sentence.replace(regex, '___');
        };
        
        return {
          sentence1: createClozeVersion(sentence1Match[1].trim(), word),
          sentence2: createClozeVersion(sentence2Match[1].trim(), word)
        };
      }
      
      throw new Error('Invalid response format');
    } catch (error) {
      console.error('Error generating cloze test:', error);
      throw error;
    } finally {
      setGeneratingCloze(false);
    }
  }, [geminiApiKey]);

  const generateDefinition = useCallback(async (word) => {
    if (!geminiApiKey) {
      return null;
    }

    setGeneratingDefinition(true);
    
    try {
      const requestBody = {
        contents: [{
          parts: [{
            text: `You are an AI that creates Oxford Dictionary-style definitions for English words. Your purpose is to help adults train their vocabulary by providing clear, precise definitions for word guessing exercises.

You will be given a word in \`<word>\` tags. Your response must follow these strict rules:

**1. Valid Word Handling:**
- For any valid English word, you must create a clear, concise definition in the style of the Oxford English Dictionary.
- The definition must be enclosed in \`<definition>\` tags.
- The part of speech must be enclosed in \`<pos>\` tags at the end, after the definition/s.
- Do NOT include the target word or its root form in the definition.
- If the word has multiple definitions, write them all with semicolons as separators, but it's crucial that if the definitions in mind are actually quite similar, try to combine them into a unifying singular definition.
- In cases where a word has multiple definitions with different parts of speech, write them all with semicolons as separators. For multiple parts of speech, separate them with semicolons in the \`<pos>\` tags (e.g., \`<pos>noun; verb</pos>\`).
- You may get a word that is an extension of a word, such as with a prefix or suffix or plural, such as "un-" or "-able" or "s" or "es", in which case you should write the definition of the word presented taking into account the alterations from the root, instead of defining the root word like they would do in a dictionary.
- **Example:** For the word "telescope", a valid output would be:
\`<definition>An optical instrument designed to make distant objects appear nearer and larger by using lenses or mirrors to collect and focus light.</definition><pos>noun</pos>\`
- **Example with multiple parts of speech:** For the word "run", a valid output would be:
\`<definition>To move rapidly on foot; a continuous period of activity or performance; to operate or function.</definition><pos>verb; noun</pos>\`

**2. Invalid Word Handling:**
- If the input is not a real English word, your entire output must be the exact text \`NOT_A_WORD\`.
- Do not use any tags for this output.
- Invalid words include:
    - Numbers
    - Random character combinations (e.g., "pvzr")
    - Malformed words (e.g., "thing's", "w8")
    - Most personal names or obscure trademarks (e.g., "Isabella", "Noah")
    - Most places
- **Exception:** You may treat widely known place names with cultural significance as valid words (e.g., "hollywood", "paris").

**3. Definition Quality Requirements:**
- **Clear and precise:** The definition should be unambiguous and help identify the specific word.
- **Standard format:** Use formal dictionary language.
- **Complete:** Provide enough information to distinguish this word from similar concepts.
- **Avoid circular definitions:** Don't use the word itself or obvious derivatives.

<word>${word}</word>`
          }]
        }]
      };

      const response = await callGeminiWithFallback(geminiApiKey, 'gemini-2.5-flash-lite-preview-06-17', requestBody);
      const text = response.text;
      
      if (text === 'NOT_A_WORD') {
        return 'NOT_A_WORD';
      }
      
      // Extract part of speech and definition from tags
      const posMatch = text.match(/<pos>(.*?)<\/pos>/s);
      const definitionMatch = text.match(/<definition>(.*?)<\/definition>/s);
      
      if (posMatch && definitionMatch) {
        // Parse parts of speech - could be multiple separated by semicolons or commas
        const partsOfSpeech = posMatch[1].trim().split(/[;,]/).map(pos => pos.trim()).filter(pos => pos);
        
        return {
          partOfSpeech: partsOfSpeech.length === 1 ? partsOfSpeech[0] : partsOfSpeech,
          definition: definitionMatch[1].trim()
        };
      }
      
      // Fallback for old format or if tags are missing
      if (definitionMatch) {
        return {
          partOfSpeech: null,
          definition: definitionMatch[1].trim()
        };
      }
      
      throw new Error('Invalid response format');
    } catch (error) {
      console.error('Error generating definition:', error);
      throw error;
    } finally {
      setGeneratingDefinition(false);
    }
  }, [geminiApiKey]);

  const generateHelpContent = useCallback(async (word, mode) => {
    if (!geminiApiKey) {
      return null;
    }

    setGeneratingHelp(true);
    
    try {
      const requestBody = {
        contents: [{
          parts: [{
            text: mode === 'normal' 
              ? `You are an AI that provides helpful definitions for a fluency training app. 

You will be given a word in \`<word>\` tags. Your response must follow these strict rules:

**1. Valid Word Handling:**
- For any valid English word, provide a clear, concise definition in \`<definition>\` tags.
- The definition should be dictionary-style, without using the word itself.
- If the word has multiple meanings, provide the most common or central definition.
- Include the part of speech in \`<pos>\` tags.

**2. Definition Quality:**
- Clear and accessible language
- Avoid circular definitions using the target word
- Focus on the most commonly understood meaning

<word>${word}</word>`
              : `You are an AI that creates example sentences for a fluency training app.

You will be given a word in \`<word>\` tags. Your response must follow these strict rules:

**1. Valid Word Handling:**
- For any valid English word, create exactly ONE example sentence showing the word in context.
- The sentence must be enclosed in \`<sentence>\` tags.
- The sentence should clearly demonstrate the word's meaning and usage.
- Make the sentence natural and informative.

**2. Sentence Quality:**
- Use clear, natural language
- Provide enough context to understand the word's meaning
- Keep it concise but informative (15-25 words ideal)
- Make the word's usage obvious from context

<word>${word}</word>`
          }]
        }]
      };

      const response = await callGeminiWithFallback(geminiApiKey, 'gemini-2.5-flash-lite-preview-06-17', requestBody);
      const text = response.text;
      
      if (mode === 'normal') {
        // Extract definition and part of speech
        const posMatch = text.match(/<pos>(.*?)<\/pos>/s);
        const definitionMatch = text.match(/<definition>(.*?)<\/definition>/s);
        
        if (posMatch && definitionMatch) {
          return {
            partOfSpeech: posMatch[1].trim(),
            definition: definitionMatch[1].trim()
          };
        }
      } else {
        // Extract sentence
        const sentenceMatch = text.match(/<sentence>(.*?)<\/sentence>/s);
        
        if (sentenceMatch) {
          // Replace the target word with underscores in the sentence
          const createClozeVersion = (sentence, targetWord) => {
            // Create regex to match the word with word boundaries, case insensitive
            const regex = new RegExp(`\\b${targetWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
            return sentence.replace(regex, '___');
          };
          
          return {
            sentence: createClozeVersion(sentenceMatch[1].trim(), word)
          };
        }
      }
      
      throw new Error('Invalid response format');
    } catch (error) {
      console.error('Error generating help content:', error);
      throw error;
    } finally {
      setGeneratingHelp(false);
    }
  }, [geminiApiKey]);

  const generateComboContent = useCallback(async (word) => {
    if (!geminiApiKey) {
      return null;
    }

    setGeneratingCombo(true);
    
    try {
      const requestBody = {
        contents: [{
          parts: [{
            text: `You are an AI that creates comprehensive word exercises for a fluency training app. Your purpose is to provide both a definition and a contextual sentence for word retrieval practice.

You will be given a word in \`<word>\` tags. Your response must follow these strict rules:

**1. Valid Word Handling:**
- For any valid English word, you must provide BOTH a definition and a cloze sentence.
- The definition must be enclosed in \`<definition>\` tags - clear, concise, dictionary-style without using the word itself.
- The part of speech must be enclosed in \`<pos>\` tags.
- The cloze sentence must be enclosed in \`<sentence>\` tags with the target word replaced by exactly three underscores (___).

**2. Definition Quality:**
- Clear and accessible language
- Avoid circular definitions using the target word
- Focus on the most commonly understood meaning
- If multiple meanings exist, choose the most common one

**3. Sentence Quality:**
- Create ONE example sentence showing the word in natural context
- The sentence should clearly demonstrate the word's meaning and usage
- Provide enough context to understand the word's meaning
- Keep it informative but concise (15-25 words ideal)
- Replace the target word with exactly three underscores: ___
- Make the word's usage obvious from context

**4. Consistency:**
- The definition and sentence should refer to the same meaning/usage of the word
- Both should work together to help identify the target word

**Example format:**
\`<definition>A large mammal with a trunk, tusks, and large ears, native to Africa and Asia.</definition>
<pos>noun</pos>
<sentence>The ___ used its trunk to pick up peanuts from the zoo visitor's hand.</sentence>\`

<word>${word}</word>`
          }]
        }]
      };

      const response = await callGeminiWithFallback(geminiApiKey, 'gemini-2.5-flash-lite-preview-06-17', requestBody);
      const text = response.text;
      
      // Extract definition, part of speech, and sentence
      const posMatch = text.match(/<pos>(.*?)<\/pos>/s);
      const definitionMatch = text.match(/<definition>(.*?)<\/definition>/s);
      const sentenceMatch = text.match(/<sentence>(.*?)<\/sentence>/s);
      
      if (posMatch && definitionMatch && sentenceMatch) {
        return {
          partOfSpeech: posMatch[1].trim(),
          definition: definitionMatch[1].trim(),
          sentence: sentenceMatch[1].trim()
        };
      }
      
      throw new Error('Invalid response format');
    } catch (error) {
      console.error('Error generating combo content:', error);
      throw error;
    } finally {
      setGeneratingCombo(false);
    }
  }, [geminiApiKey]);

  const handleHelp = useCallback(async () => {
    if (!currentWord || helpUsed || generatingHelp) return;
    
    try {
      const helpResult = await generateHelpContent(currentWord, trainingMode);
      setHelpContent(helpResult);
      setHelpUsed(true);
    } catch (error) {
      console.error('Error generating help:', error);
    }
  }, [currentWord, helpUsed, generatingHelp, generateHelpContent, trainingMode]);

  const selectNewWordNormal = useCallback(async () => {
    if (!wordData) return;

    const wordsInRange = getWordsInZipfRange(normalZipfLevel);
    if (wordsInRange.length === 0) {
      console.error('No words found in range');
      return;
    }

    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const selectedWord = selectWordWithWeighting(wordsInRange);
      if (!selectedWord) {
        console.error('Failed to select word');
        return;
      }
      
      try {
        const clozeResult = await generateClozeTest(selectedWord);
        if (clozeResult === 'NOT_A_WORD') {
          attempts++;
          continue; // Try another word
        }
        
        setCurrentWord(selectedWord);
        addToRecentWords(selectedWord);
        setClozeTest(clozeResult);
        setUserAnswer('');
        setNormalScore(null);
        setShowAnswer(false);
        setHelpUsed(false);
        setHelpContent(null);
        return;
      } catch (error) {
        attempts++;
        if (attempts === maxAttempts) {
          console.error('Failed to generate cloze test after', maxAttempts, 'attempts');
          return;
        }
      }
    }
  }, [wordData, normalZipfLevel, generateClozeTest, getWordsInZipfRange, selectWordWithWeighting, addToRecentWords]);

  const selectNewWordReverse = useCallback(() => {
    if (!wordData) return;

    const wordsInRange = getWordsInZipfRange(reverseZipfLevel);
    if (wordsInRange.length === 0) {
      console.error('No words found in range');
      return;
    }

    const selectedWord = selectWordWithWeighting(wordsInRange);
    if (!selectedWord) {
      console.error('Failed to select word');
      return;
    }
    
    setCurrentWord(selectedWord);
    addToRecentWords(selectedWord);
    setUserDefinition('');
    setScore(null);
    setCorrectDefinition('');
    setShowAnswer(false);
    setHelpUsed(false);
    setHelpContent(null);
  }, [wordData, reverseZipfLevel, getWordsInZipfRange, selectWordWithWeighting, addToRecentWords]);

  const selectNewWordDefinition = useCallback(async () => {
    if (!wordData) return;

    const wordsInRange = getWordsInZipfRange(definitionZipfLevel);
    if (wordsInRange.length === 0) {
      console.error('No words found in range');
      return;
    }

    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const selectedWord = selectWordWithWeighting(wordsInRange);
      if (!selectedWord) {
        console.error('Failed to select word');
        return;
      }
      
      try {
        const definitionResult = await generateDefinition(selectedWord);
        if (definitionResult === 'NOT_A_WORD') {
          attempts++;
          continue; // Try another word
        }
        
        setCurrentWord(selectedWord);
        addToRecentWords(selectedWord);
        setWordDefinition(definitionResult);
        setUserGuess('');
        setDefinitionScore(null);
        setShowAnswer(false);
        setHelpUsed(false);
        setHelpContent(null);
        return;
      } catch (error) {
        attempts++;
        if (attempts === maxAttempts) {
          console.error('Failed to generate definition after', maxAttempts, 'attempts');
          return;
        }
      }
    }
  }, [wordData, definitionZipfLevel, generateDefinition, getWordsInZipfRange, selectWordWithWeighting, addToRecentWords]);

  const selectNewWordCombo = useCallback(async () => {
    if (!wordData) return;

    const wordsInRange = getWordsInZipfRange(comboZipfLevel);
    if (wordsInRange.length === 0) {
      console.error('No words found in range');
      return;
    }

    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const selectedWord = selectWordWithWeighting(wordsInRange);
      if (!selectedWord) {
        console.error('Failed to select word');
        return;
      }
      
      try {
        const comboResult = await generateComboContent(selectedWord);
        
        setCurrentWord(selectedWord);
        addToRecentWords(selectedWord);
        setComboContent(comboResult);
        setUserComboAnswer('');
        setComboScore(null);
        setShowAnswer(false);
        setHelpUsed(false);
        setHelpContent(null);
        return;
      } catch (error) {
        attempts++;
        if (attempts === maxAttempts) {
          console.error('Failed to generate combo content after', maxAttempts, 'attempts');
          return;
        }
      }
    }
  }, [wordData, comboZipfLevel, generateComboContent, getWordsInZipfRange, selectWordWithWeighting, addToRecentWords]);

  const selectNewWord = useCallback(async () => {
    if (!wordData) return;

    // Reset dispute state for new word
    setDisputeInProgress(false);
    setDisputeResolved(false);
    setDisputeResult(null);
    setDisputeError(null);

    if (trainingMode === 'reverse') {
      selectNewWordReverse();
    } else if (trainingMode === 'definition') {
      await selectNewWordDefinition();
    } else if (trainingMode === 'combo') {
      await selectNewWordCombo();
    } else {
      await selectNewWordNormal();
    }
  }, [wordData, trainingMode, selectNewWordReverse, selectNewWordDefinition, selectNewWordCombo, selectNewWordNormal]);

  // Function to filter out invalid words
  const filterValidWords = useCallback((words) => {
    const validWords = {};
    for (const [word, data] of Object.entries(words)) {
      // Check if word is valid:
      // - At least 2 characters long
      // - Only contains letters, apostrophes, hyphens, and spaces (valid word characters)
      // - No numbers or other special characters
      // - Not a common name
      if (
        word.length >= 2 &&
        /^[a-zA-Z'\- ]+$/.test(word) &&
        !isName(word)
      ) {
        validWords[word] = data;
      }
    }
    return validWords;
  }, [isName]);

  // Load name data
  useEffect(() => {
    const loadNameData = async () => {
      try {
        const [maleResponse, femaleResponse] = await Promise.all([
          fetch('/Fluency-Trainer/data/male.txt').catch(() => fetch('/data/male.txt')),
          fetch('/Fluency-Trainer/data/female.txt').catch(() => fetch('/data/female.txt'))
        ]);

        const [maleText, femaleText] = await Promise.all([
          maleResponse.text(),
          femaleResponse.text()
        ]);

        const names = new Set();
        
        // Add male names
        maleText.split('\n').forEach(name => {
          const trimmed = name.trim().toLowerCase();
          if (trimmed) names.add(trimmed);
        });
        
        // Add female names
        femaleText.split('\n').forEach(name => {
          const trimmed = name.trim().toLowerCase();
          if (trimmed) names.add(trimmed);
        });

        setNameData(names);
      } catch (error) {
        console.error('Error loading name data:', error);
        // Continue without name filtering if loading fails
        setNameData(new Set());
      }
    };

    loadNameData();
  }, []);

  // Load word frequency data
  useEffect(() => {
    // Only load word data after name data is ready
    if (nameData.size === 0) return;

    // Try production path first, fallback to dev path
    const productionPath = '/Fluency-Trainer/data/en_frequencies.json';
    const devPath = '/data/en_frequencies.json';
    
    fetch(productionPath)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Production path failed');
        }
        return response.json();
      })
      .then((data) => {
        const cleanedWords = filterValidWords(data.words);
        setWordData(cleanedWords);
        setLoading(false);
      })
      .catch(() => {
        // Fallback to dev path
        fetch(devPath)
          .then((response) => response.json())
          .then((data) => {
            const cleanedWords = filterValidWords(data.words);
            setWordData(cleanedWords);
            setLoading(false);
          })
          .catch((error) => {
            console.error('Error loading word data:', error);
            setLoading(false);
          });
      });
  }, [nameData, filterValidWords]);

  // Check if first time user and show welcome modal
  useEffect(() => {
    const hasVisited = localStorage.getItem('hasVisitedBefore');
    if (!hasVisited) {
      setShowWelcomeModal(true);
      localStorage.setItem('hasVisitedBefore', 'true');
    }
  }, []);

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem('zipfLevels', JSON.stringify(zipfLevels));
  }, [zipfLevels]);


  useEffect(() => {
    localStorage.setItem('trainingMode', trainingMode);
  }, [trainingMode]);

  useEffect(() => {
    localStorage.setItem('geminiApiKey', geminiApiKey);
  }, [geminiApiKey]);

  useEffect(() => {
    localStorage.setItem('reverseZipfLevel', reverseZipfLevel.toString());
  }, [reverseZipfLevel]);

  useEffect(() => {
    localStorage.setItem('normalZipfLevel', normalZipfLevel.toString());
  }, [normalZipfLevel]);

  useEffect(() => {
    localStorage.setItem('definitionZipfLevel', definitionZipfLevel.toString());
  }, [definitionZipfLevel]);

  useEffect(() => {
    localStorage.setItem('comboZipfLevel', comboZipfLevel.toString());
  }, [comboZipfLevel]);

  useEffect(() => {
    localStorage.setItem('recentWords', JSON.stringify(recentWords));
  }, [recentWords]);

  // Select new word when relevant state changes
  useEffect(() => {
    if (!loading && wordData) {
      selectNewWord();
    }
  }, [loading, wordData, trainingMode]);

  const gradeDefinition = useCallback(async (word, userDef) => {
    if (!geminiApiKey) {
      return;
    }

    setGrading(true);
    
    try {
      const requestBody = {
        contents: [{
          parts: [{
            text: `I am in a fluency trainer app. For the given word and user's definition, I need to:

1.  First, provide a concise, accurate definition of the word in \`<definition>\` tags. The definition should be in a dictionary style, without using the word itself.
    *   **Crucially, combine related senses into a single, cohesive definition.** Do not use semicolons to separate slight variations of the same core meaning. For example, for 'keep', a good definition would be "To retain possession of, or maintain in a particular state, place, or condition," not "To retain possession of; to maintain in a particular state...".
    *   Only use a semicolon to separate **fundamentally distinct** meanings that cannot be generalized. For example, \`bat\` (a flying mammal) and \`bat\` (sports equipment) are fundamentally distinct.
    *   If the word has distinct meanings, write the definition the user was aiming for first.

2.  Then, grade the user's definition from 1 to 5 in \`<grade>\` tags.

If a word has multiple definitions, and the user defined one that you weren't initially focused on, grade them for the meaning they were trying to define.

**Grading Rubric:**
*   **1: Irrelevant.** The definition is completely wrong or unrelated.
*   **2: Not There** Touches upon a related concept but misses the core meaning AND/OR uses the root of the word or the word itself in the definition.
*   **3: Alright** The main concept is correct, but the definition is imperfect. A smart individual would understand the description matches the word.
*   **4: Accurate.** A solid, correct definition that shows good understanding.
*   **5: Precise & Nuanced.** A comprehensive, almost dictionary-quality definition.

Ignore typos.
Respond ONLY with the definition and grade in the specified tags, nothing else.

Word: ${word}
User's definition: ${userDef}`
          }]
        }]
      };

      const response = await callGeminiWithFallback(geminiApiKey, 'gemini-2.5-flash-lite-preview-06-17', requestBody);
      const text = response.text;
      
      // Extract definition and grade
      const defMatch = text.match(/<definition>(.*?)<\/definition>/s);
      const gradeMatch = text.match(/<grade>(\d+)<\/grade>/);
      
      if (defMatch && gradeMatch) {
        const definition = defMatch[1].trim();
        const grade = parseInt(gradeMatch[1]);
        
        setCorrectDefinition(definition);
        setScore(grade);
        
        // Store the grade for difficulty adjustment when user moves to next word
        // Don't adjust difficulty immediately to avoid auto-advancing
      }
    } catch (error) {
      console.error('Error grading definition:', error);
      alert('Error grading definition. Please check your API key.');
    } finally {
      setGrading(false);
    }
  }, [geminiApiKey]);

  const handleNormalAnswer = useCallback(() => {
    if (!userAnswer.trim()) return;
    
    const correct = isAnswerCorrect(userAnswer, currentWord);
    setNormalScore(correct ? 1 : 0);
    setShowAnswer(true);
    // Don't adjust difficulty here - wait for user to click "Next Word"
  }, [userAnswer, currentWord, isAnswerCorrect]);

  const handleDifficulty = (harder) => {
    // This is now only used for manual difficulty adjustment if needed
    if (trainingMode === 'normal') {
      setNormalZipfLevel(prev => harder ? prev - ZIPF_ADJUSTMENT : prev + ZIPF_ADJUSTMENT);
    }
    setCorrectDefinition('');
  };

  // Removed togglePartOfSpeech function as we no longer filter by parts of speech

  // Removed togglePreference function as we no longer have display preferences

  const handleModeChange = (mode) => {
    setTrainingMode(mode);
    // Reset state when changing modes
    setShowAnswer(false);
    
    // Reset normal mode state
    setClozeTest('');
    setUserAnswer('');
    setNormalScore(null);
    
    // Reset reverse mode state
    setUserDefinition('');
    setScore(null);
    setCorrectDefinition('');
    
    // Reset definition mode state
    setWordDefinition('');
    setUserGuess('');
    setDefinitionScore(null);
    
    // Reset combo mode state
    setComboContent(null);
    setUserComboAnswer('');
    setComboScore(null);
    
    // Reset help state
    setHelpUsed(false);
    setHelpContent(null);
  };

  const handleNextWordNormal = useCallback(() => {
    // Apply difficulty adjustment based on the current score and help usage
    if (normalScore !== null) {
      if (normalScore === 1) {
        // Correct - only make it harder if help wasn't used
        if (!helpUsed) {
          setNormalZipfLevel(prev => prev - ZIPF_ADJUSTMENT);
        }
        // If help was used and answer correct, no difficulty change
      } else {
        // Incorrect - make it easier (higher Zipf) regardless of help usage
        setNormalZipfLevel(prev => prev + ZIPF_ADJUSTMENT);
      }
    }
    
    // Select new word
    selectNewWord();
  }, [normalScore, helpUsed, selectNewWord]);

  const handleNextWordReverse = useCallback(() => {
    // Apply difficulty adjustment based on the current score
    // Higher Zipf = easier words, so correct answers should decrease Zipf (make harder)
    if (score !== null) {
      if (score >= 3) {
        // Correct - make it harder (lower Zipf)
        setReverseZipfLevel(prev => prev - ZIPF_ADJUSTMENT);
      } else {
        // Incorrect - make it easier (higher Zipf)
        setReverseZipfLevel(prev => prev + ZIPF_ADJUSTMENT);
      }
    }
    
    // Select new word
    selectNewWord();
  }, [score, selectNewWord]);

  const handleNextWordDefinition = useCallback(() => {
    // Apply difficulty adjustment based on the current score and help usage
    if (definitionScore !== null) {
      if (definitionScore === 1) {
        // Correct - only make it harder if help wasn't used
        if (!helpUsed) {
          setDefinitionZipfLevel(prev => prev - ZIPF_ADJUSTMENT);
        }
        // If help was used and answer correct, no difficulty change
      } else {
        // Incorrect - make it easier (higher Zipf) regardless of help usage
        setDefinitionZipfLevel(prev => prev + ZIPF_ADJUSTMENT);
      }
    }
    
    // Select new word
    selectNewWord();
  }, [definitionScore, helpUsed, selectNewWord]);

  const handleComboAnswer = useCallback(() => {
    if (!userComboAnswer.trim()) return;
    
    const correct = isAnswerCorrect(userComboAnswer, currentWord);
    setComboScore(correct ? 1 : 0);
    setShowAnswer(true);
    // Don't adjust difficulty here - wait for user to click "Next Word"
  }, [userComboAnswer, currentWord, isAnswerCorrect]);

  const handleNextWordCombo = useCallback(() => {
    // Apply difficulty adjustment based on the current score
    if (comboScore !== null) {
      if (comboScore === 1) {
        // Correct - make it harder (lower Zipf)
        setComboZipfLevel(prev => prev - ZIPF_ADJUSTMENT);
      } else {
        // Incorrect - make it easier (higher Zipf)
        setComboZipfLevel(prev => prev + ZIPF_ADJUSTMENT);
      }
    }
    
    // Select new word
    selectNewWord();
  }, [comboScore, selectNewWord]);

  const handleDefinitionAnswer = useCallback(() => {
    if (!userGuess.trim()) return;
    
    const correct = isAnswerCorrect(userGuess, currentWord);
    setDefinitionScore(correct ? 1 : 0);
    setShowAnswer(true);
    // Don't adjust difficulty here - wait for user to click "Next Word"
  }, [userGuess, currentWord, isAnswerCorrect]);

  // Handle dispute resolution
  const handleDispute = useCallback(async () => {
    if (!geminiApiKey) {
      setShowApiKeyModal(true);
      return;
    }

    setDisputeInProgress(true);
    setDisputeError(null); // Clear any previous errors
    
    try {
      const context = prepareDisputeContext(trainingMode, {
        currentWord,
        clozeTest,
        userAnswer,
        wordDefinition,
        userGuess,
        userComboAnswer,
        comboContent,
        helpContent
      });

      const disputeResponse = await resolveDispute(geminiApiKey, trainingMode, context);
      
      setDisputeResult(disputeResponse);
      setDisputeResolved(true);
      
      if (disputeResponse.accepted) {
        // Override the score to success
        if (trainingMode === 'normal') {
          setNormalScore(1);
        } else if (trainingMode === 'definition') {
          setDefinitionScore(1);
        } else if (trainingMode === 'combo') {
          setComboScore(1);
        }
      }
    } catch (error) {
      console.error('Dispute resolution failed:', error);
      
      // Set user-friendly error message
      let errorMessage = 'Failed to resolve dispute. ';
      if (error.message.includes('API key')) {
        errorMessage += 'Please check your API key.';
      } else if (error.message.includes('rate limit') || error.message.includes('quota')) {
        errorMessage += 'API limit reached. Please try again later.';
      } else if (error.message.includes('network') || error.message.includes('fetch')) {
        errorMessage += 'Network error. Please check your connection and try again.';
      } else {
        errorMessage += 'Please try again.';
      }
      
      setDisputeError(errorMessage);
    } finally {
      setDisputeInProgress(false);
    }
  }, [trainingMode, geminiApiKey, currentWord, clozeTest, userAnswer, wordDefinition, userGuess, userComboAnswer, comboContent, helpContent]);

  // Auto-focus input when a new question is ready
  useEffect(() => {
    if (trainingMode === 'normal' && clozeTest && normalModeInputRef.current) {
      // Use a timeout to ensure focus happens after render and state updates.
      const timer = setTimeout(() => {
        normalModeInputRef.current.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [trainingMode, clozeTest]);

  useEffect(() => {
    if (trainingMode === 'reverse' && currentWord && score === null && reverseModeInputRef.current) {
      const timer = setTimeout(() => {
        reverseModeInputRef.current.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [trainingMode, currentWord, score]);

  useEffect(() => {
    if (trainingMode === 'definition' && wordDefinition && definitionModeInputRef.current) {
      const timer = setTimeout(() => {
        definitionModeInputRef.current.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [trainingMode, wordDefinition]);

  useEffect(() => {
    if (trainingMode === 'combo' && comboContent && comboModeInputRef.current) {
      const timer = setTimeout(() => {
        comboModeInputRef.current.focus();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [trainingMode, comboContent]);

  // Global keyboard event listener for Enter key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key !== 'Enter') return;

      const activeElement = document.activeElement;

      if (trainingMode === 'normal') {
        if (showAnswer) {
          handleNextWordNormal();
        } else if (activeElement === normalModeInputRef.current) {
          handleNormalAnswer();
        }
      } else if (trainingMode === 'reverse') {
        if (score !== null) {
          handleNextWordReverse();
        } else if (activeElement === reverseModeInputRef.current && !e.shiftKey) {
          e.preventDefault();
          if (userDefinition.trim() && !grading && geminiApiKey) {
            gradeDefinition(currentWord, userDefinition);
          }
        }
             } else if (trainingMode === 'definition') {
         if (showAnswer) {
           handleNextWordDefinition();
         } else if (activeElement === definitionModeInputRef.current) {
           handleDefinitionAnswer();
         }
      } else if (trainingMode === 'combo') {
        if (showAnswer) {
          handleNextWordCombo();
        } else if (activeElement === comboModeInputRef.current) {
          handleComboAnswer();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [
    trainingMode,
    showAnswer,
    score,
    userDefinition,
    currentWord,
    geminiApiKey,
    grading,
    handleNormalAnswer,
    handleNextWordNormal,
    handleNextWordReverse,
    handleNextWordDefinition,
    handleDefinitionAnswer,
    handleComboAnswer,
    handleNextWordCombo,
    gradeDefinition,
  ]);

  if (loading) {
    return <div className="text-center py-8 text-slate-600 dark:text-slate-400">Loading word data...</div>;
  }

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-900 transition-colors duration-200">
      <div className="max-w-2xl mx-auto p-6">
        <div className="bg-white dark:bg-zinc-900 transition-colors duration-200">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-5xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 dark:from-slate-200 dark:to-slate-400 bg-clip-text text-transparent mb-4">
            Fluency Trainer
          </h1>
          <p className="text-lg text-slate-600 dark:text-slate-400 max-w-lg mx-auto font-medium">
            Enhance fluency through general verbal retrieval practice
          </p>
        </div>

        {/* Mode Selection */}
        <div className="mb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4 p-1 bg-gray-100 dark:bg-zinc-800 rounded-lg">
            <button
              onClick={() => handleModeChange('normal')}
              className={`px-4 py-3 rounded-md font-medium transition-all duration-200 ${trainingMode === 'normal' 
                ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                : 'text-gray-600 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'}`}
            >
              Normal Mode
              <div className="text-xs opacity-75">Context → Word</div>
            </button>
            <button
              onClick={() => handleModeChange('reverse')}
              className={`px-4 py-3 rounded-md font-medium transition-all duration-200 ${trainingMode === 'reverse' 
                ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                : 'text-gray-600 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'}`}
            >
              Reverse Mode
              <div className="text-xs opacity-75">Word → Definition</div>
            </button>
            <button
              onClick={() => handleModeChange('definition')}
              className={`px-4 py-3 rounded-md font-medium transition-all duration-200 ${trainingMode === 'definition' 
                ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                : 'text-gray-600 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'}`}
            >
              Definition Mode
              <div className="text-xs opacity-75">Definition → Word</div>
            </button>
            <button
              onClick={() => handleModeChange('combo')}
              className={`px-4 py-3 rounded-md font-medium transition-all duration-200 ${trainingMode === 'combo' 
                ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                : 'text-gray-600 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'}`}
            >
              Combo Mode
              <div className="text-xs opacity-75">Both → Word</div>
            </button>
          </div>
          
        </div>

        {/* Header with Settings */}
        <div className="flex justify-between items-start mb-6">
          <div className="flex items-center gap-4">
            <div className="bg-gray-50 dark:bg-zinc-800 px-3 py-2 rounded-lg">
              <div className="text-xs text-gray-500 dark:text-zinc-400 mb-1">Difficulty Level</div>
              <div className="text-sm font-semibold text-gray-700 dark:text-zinc-300">
                {trainingMode === 'reverse' 
                  ? reverseZipfLevel.toFixed(2)
                  : trainingMode === 'definition'
                  ? definitionZipfLevel.toFixed(2)
                  : trainingMode === 'combo'
                  ? comboZipfLevel.toFixed(2)
                  : normalZipfLevel.toFixed(2)}
              </div>
            </div>
            {geminiApiKey && (
              <div className="flex items-center text-sm text-green-600 dark:text-green-400">
                <div className="w-2 h-2 bg-green-500 dark:bg-green-400 rounded-full mr-2"></div>
                AI Ready
              </div>
            )}
          </div>
          
          {/* Settings Menu */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowWelcomeModal(true)}
              className="p-2 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
              title="Help"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
            <button
              onClick={() => {
                setTempApiKey(geminiApiKey);
                setShowApiKeyModal(true);
              }}
              className="p-2 text-gray-400 dark:text-zinc-500 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Normal Mode - Cloze Test Display */}
        {trainingMode === 'normal' && (
          <div className="space-y-6">
            {!geminiApiKey ? (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
                  API Key Required
                </h3>
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                  Cloze sentences require a Gemini API key. Click "Set API Key" above to get started.
                </p>
                <button
                  onClick={() => {
                    setTempApiKey('');
                    setShowApiKeyModal(true);
                  }}
                  className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors text-sm font-medium"
                >
                  Set API Key
                </button>
              </div>
            ) : generatingCloze ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 dark:border-blue-400 border-t-transparent mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-400">Generating cloze sentences...</p>
              </div>
            ) : clozeTest ? (
              <div className="space-y-6">
                {/* Question Prompt */}
                <div className="text-left">
                  <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
                    Fill in the blanks with the same word:
                  </h3>
                </div>

                {/* Both Sentences Display */}
                <div className="bg-gradient-to-br from-blue-50/30 to-slate-100 dark:bg-gradient-to-br dark:from-blue-500/5 dark:to-blue-600/5 p-6 rounded-xl border border-slate-200/60 dark:border-zinc-800">
                  <div className="space-y-4">
                    {typeof clozeTest === 'object' ? (
                      <>
                        <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-gray-200 dark:border-zinc-700">
                          <p className="text-lg text-gray-700 dark:text-gray-300 leading-relaxed">
                            {clozeTest.sentence1}
                          </p>
                        </div>
                        
                        <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-gray-200 dark:border-zinc-700">
                          <p className="text-lg text-gray-700 dark:text-gray-300 leading-relaxed">
                            {clozeTest.sentence2}
                          </p>
                        </div>
                      </>
                    ) : (
                      <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-gray-200 dark:border-zinc-700">
                        <p className="text-lg text-gray-700 dark:text-gray-300 leading-relaxed">
                          {clozeTest}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Answer Input */}
                <div className="space-y-4">
                  <input
                    ref={normalModeInputRef}
                    type="text"
                    value={userAnswer}
                    onChange={(e) => setUserAnswer(e.target.value)}
                    placeholder="Type your answer here..."
                    className="w-full px-4 py-3 border-2 border-gray-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-zinc-500"
                    disabled={showAnswer}
                  />
                  
                  {/* Help Content Display */}
                  {helpContent && trainingMode === 'normal' && (
                    <div className="bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
                      <div className="flex items-center mb-2">
                        <svg className="w-4 h-4 text-gray-500 dark:text-zinc-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h4 className="text-sm font-medium text-gray-700 dark:text-zinc-300">Help: Definition</h4>
                      </div>
                      <div className="text-sm text-gray-600 dark:text-zinc-400">
                        {helpContent.partOfSpeech && (
                          <span className="inline-block bg-gray-200 dark:bg-zinc-700 text-gray-700 dark:text-zinc-300 px-2 py-1 rounded text-xs font-medium mr-2 mb-2">
                            {helpContent.partOfSpeech}
                          </span>
                        )}
                        <p>{helpContent.definition}</p>
                      </div>
                    </div>
                  )}
                  
                  {!showAnswer && (
                    <div className="flex gap-2">
                      <button
                        onClick={handleNormalAnswer}
                        disabled={!userAnswer.trim()}
                        className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-500 dark:to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 dark:hover:from-blue-600 dark:hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-400 dark:disabled:from-zinc-600 dark:disabled:to-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                      >
                        Submit Answer
                      </button>
                      {!helpUsed && (
                        <button
                          onClick={handleHelp}
                          disabled={generatingHelp}
                          className="px-4 py-3 bg-gray-500 dark:bg-zinc-500 text-white rounded-xl hover:bg-gray-600 dark:hover:bg-zinc-600 disabled:bg-gray-400 dark:disabled:bg-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                          title="Get definition help"
                        >
                          {generatingHelp ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                          ) : (
                            'Help'
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Answer Feedback */}
                {showAnswer && (
                  <div className="space-y-4">
                    <div className={`p-4 rounded-xl border-2 ${
                      normalScore === 1 
                        ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-zinc-700' 
                        : 'bg-red-50/40 dark:bg-red-500/10 border-red-100/60 dark:border-red-500/20'
                    }`}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                          {normalScore === 1 ? 'Correct!' : 'Incorrect'}
                        </h4>
                        <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                          normalScore === 1 
                            ? 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200' 
                            : 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200'
                        }`}>
                          {normalScore === 1 ? 'Right' : 'Wrong'}
                        </span>
                      </div>
                      
                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="bg-white dark:bg-zinc-800 p-3 rounded-lg border border-gray-100 dark:border-zinc-700">
                          <h5 className="font-medium text-gray-800 dark:text-gray-200 mb-1">
                            Correct Answer
                          </h5>
                          <p className="text-gray-700 dark:text-gray-300">{currentWord}</p>
                        </div>
                        <div className="bg-white dark:bg-zinc-800 p-3 rounded-lg border border-gray-100 dark:border-zinc-700">
                          <h5 className="font-medium text-gray-800 dark:text-gray-200 mb-1">
                            Your Answer
                          </h5>
                          <p className={`${
                            normalScore === 1 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                          }`}>{userAnswer}</p>
                        </div>
                      </div>
                    </div>
                    
                    {disputeResult && (
                      <div className={`p-4 rounded-xl border-2 ${
                        disputeResult.accepted 
                          ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-zinc-700' 
                          : 'bg-gray-50 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-2 h-2 rounded-full ${
                            disputeResult.accepted ? 'bg-blue-500' : 'bg-gray-500'
                          }`}></div>
                          <h5 className="font-medium text-gray-800 dark:text-gray-200">
                            Dispute {disputeResult.accepted ? 'Accepted' : 'Rejected'}
                          </h5>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          {disputeResult.explanation}
                        </p>
                      </div>
                    )}
                    
                    {disputeError && (
                      <div className="p-4 rounded-xl border-2 bg-red-50/40 dark:bg-red-500/10 border-red-100/60 dark:border-red-500/20 mb-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-2 h-2 rounded-full bg-red-500"></div>
                          <h5 className="font-medium text-gray-800 dark:text-gray-200">
                            Dispute Failed
                          </h5>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                          {disputeError}
                        </p>
                        <button
                          onClick={handleDispute}
                          disabled={disputeInProgress}
                          className="px-4 py-3 bg-orange-400 dark:bg-orange-600 text-white rounded-xl hover:bg-orange-500 dark:hover:bg-orange-700 disabled:bg-gray-400 dark:disabled:bg-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                        >
                          {disputeInProgress ? 'Retrying...' : 'Try Again'}
                        </button>
                      </div>
                    )}
                    
                    <div className="flex gap-3">
                      {normalScore === 0 && !disputeResolved && (
                        <button
                          onClick={handleDispute}
                          disabled={disputeInProgress}
                          className="px-4 py-3 bg-orange-400 dark:bg-orange-600 text-white rounded-xl hover:bg-orange-500 dark:hover:bg-orange-700 disabled:bg-gray-400 dark:disabled:bg-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                          title="Dispute this result - AI will re-evaluate your answer"
                        >
                          {disputeInProgress ? (
                            <div className="flex items-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                              Reviewing...
                            </div>
                          ) : (
                            'Dispute'
                          )}
                        </button>
                      )}
                      <button
                        onClick={handleNextWordNormal}
                        className="flex-1 px-6 py-4 bg-blue-400 text-white rounded-xl hover:bg-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600 font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl"
                      >
                        Next Word
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-600 dark:text-gray-400">Loading word...</p>
              </div>
            )}
          </div>
        )}

        {/* Reverse Mode - Word Display and Definition Input */}
        {trainingMode === 'reverse' && (
          <div className="space-y-6">
            {!geminiApiKey ? (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
                  API Key Required
                </h3>
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                  Reverse mode requires a Gemini API key to grade your definitions. Click "Set API Key" above to get started.
                </p>
                <button
                  onClick={() => {
                    setTempApiKey('');
                    setShowApiKeyModal(true);
                  }}
                  className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors text-sm font-medium"
                >
                  Set API Key
                </button>
              </div>
            ) : !currentWord ? (
              <div className="text-center py-8">
                <p className="text-gray-600 dark:text-gray-400">Loading word...</p>
              </div>
            ) : (
              <div className="space-y-6">
            {/* Word Display */}
            <div className="text-center bg-gradient-to-br from-blue-50/30 to-slate-100 dark:bg-gradient-to-br dark:from-blue-500/5 dark:to-blue-600/5 p-8 rounded-xl border border-slate-200/60 dark:border-zinc-800">
              <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-gray-200 dark:border-zinc-700">
                <h2 className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                  {currentWord}
                </h2>
                <p className="text-lg text-gray-700 dark:text-gray-300 mt-2">
                  How would you define this word?
                </p>
              </div>
            </div>

            {/* Definition Input */}
            <div className="space-y-4">
              <div className="relative">
                <textarea
                  ref={reverseModeInputRef}
                  value={userDefinition}
                  onChange={(e) => setUserDefinition(e.target.value)}
                  placeholder="Type your definition here... Be as detailed and accurate as possible!"
                  className="w-full h-36 px-4 py-3 border-2 border-gray-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent resize-none text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-zinc-500"
                  disabled={grading || score !== null}
                />
                <div className="absolute bottom-3 right-3 text-xs text-gray-400 dark:text-gray-500">
                  {userDefinition.length} characters
                </div>
              </div>
              
              {score === null && (
                <button
                  onClick={() => gradeDefinition(currentWord, userDefinition)}
                  disabled={!userDefinition.trim() || grading || !geminiApiKey}
                  className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-500 dark:to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 dark:hover:from-blue-600 dark:hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-400 dark:disabled:from-zinc-600 dark:disabled:to-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                >
                  {grading ? (
                    <div className="flex items-center justify-center">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
                      AI is grading...
                    </div>
                  ) : (
                    'Submit Definition'
                  )}
                </button>
              )}
            </div>

            {/* Score and Correct Definition Display */}
            {score !== null && (
              <div className="space-y-6">
                <div className={`p-6 rounded-xl border-2 ${
                  score >= 3 
                    ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-zinc-700' 
                    : 'bg-red-50/40 dark:bg-red-500/10 border-red-100/60 dark:border-red-500/20'
                }`}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200">
                        Score: {score}/5
                      </h3>
                      <div className="flex items-center mt-1">
                        {[1, 2, 3, 4, 5].map(i => (
                          <div key={i} className={`w-3 h-3 rounded-full mr-1 ${
                            i <= score ? 'bg-yellow-400 dark:bg-yellow-400' : 'bg-gray-200 dark:bg-zinc-600'
                          }`}></div>
                        ))}
                      </div>
                    </div>
                    <span className={`px-4 py-2 rounded-full text-sm font-bold ${
                      score >= 3 
                        ? 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200' 
                        : 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200'
                    }`}>
                      {score >= 3 ? 'Good Definition!' : 'Needs Improvement'}
                    </span>
                  </div>
                  
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-gray-100 dark:border-zinc-700">
                      <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-2">
                        Correct Definition
                      </h4>
                      <p className="text-gray-700 dark:text-gray-300 leading-relaxed">{correctDefinition}</p>
                    </div>
                    <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-gray-100 dark:border-zinc-700">
                      <h4 className="font-semibold text-gray-800 dark:text-gray-200 mb-2">
                        Your Definition
                      </h4>
                      <p className="text-gray-600 dark:text-gray-400 italic leading-relaxed">{userDefinition}</p>
                    </div>
                  </div>
                </div>
                
                <button
                  onClick={handleNextWordReverse}
                  className="w-full px-6 py-4 bg-blue-400 text-white rounded-xl hover:bg-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600 font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  Next Word
                </button>
              </div>
            )}
              </div>
            )}
          </div>
        )}

        {/* Definition Mode - Definition Display and Word Input */}
        {trainingMode === 'definition' && (
          <div className="space-y-6">
            {!geminiApiKey ? (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
                  API Key Required
                </h3>
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                  Definition mode requires a Gemini API key to generate dictionary-style definitions. Click "Set API Key" above to get started.
                </p>
                <button
                  onClick={() => {
                    setTempApiKey('');
                    setShowApiKeyModal(true);
                  }}
                  className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors text-sm font-medium"
                >
                  Set API Key
                </button>
              </div>
            ) : generatingDefinition ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 dark:border-blue-400 border-t-transparent mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-400">Generating definition...</p>
              </div>
            ) : wordDefinition ? (
              <div className="space-y-6">
                {/* Question Prompt */}
                <div className="text-left">
                  <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
                    Can you guess this word?
                  </h3>
                </div>

                {/* Definition Display */}
                <div className="bg-gradient-to-br from-purple-50/30 to-slate-100 dark:bg-gradient-to-br dark:from-purple-500/5 dark:to-purple-600/5 p-6 rounded-xl border border-slate-200/60 dark:border-zinc-800">
                  <div className="bg-white dark:bg-zinc-800 p-6 rounded-lg shadow-sm border border-purple-200 dark:border-zinc-700">
                    {/* Display part of speech and definition */}
                    {typeof wordDefinition === 'object' && wordDefinition.partOfSpeech ? (
                      <>
                        <div className="mb-3">
                          {/* Handle both single and multiple parts of speech */}
                          {Array.isArray(wordDefinition.partOfSpeech) ? (
                            <div className="flex flex-wrap gap-2">
                              {wordDefinition.partOfSpeech.map((pos, index) => (
                                <span key={index} className="inline-block bg-purple-100 dark:bg-purple-800 text-purple-800 dark:text-purple-200 px-3 py-1 rounded-full text-sm font-medium">
                                  {pos}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="inline-block bg-purple-100 dark:bg-purple-800 text-purple-800 dark:text-purple-200 px-3 py-1 rounded-full text-sm font-medium">
                              {wordDefinition.partOfSpeech}
                            </span>
                          )}
                        </div>
                        <p className="text-lg text-gray-800 dark:text-gray-200 leading-relaxed text-left">
                          {wordDefinition.definition}
                        </p>
                      </>
                    ) : (
                      <p className="text-lg text-gray-800 dark:text-gray-200 leading-relaxed text-left">
                        {typeof wordDefinition === 'object' ? wordDefinition.definition : wordDefinition}
                      </p>
                    )}
                  </div>
                </div>

                {/* Answer Input */}
                <div className="space-y-4">
                  <input
                    type="text"
                    ref={definitionModeInputRef}
                    value={userGuess}
                    onChange={(e) => setUserGuess(e.target.value)}
                    placeholder="Type your guess here..."
                    className="w-full px-4 py-3 border-2 border-gray-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 dark:focus:ring-purple-400 focus:border-transparent text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-zinc-500"
                    disabled={showAnswer}
                  />
                  
                  {/* Help Content Display */}
                  {helpContent && trainingMode === 'definition' && (
                    <div className="bg-gray-50 dark:bg-zinc-800 border border-gray-200 dark:border-zinc-700 rounded-lg p-4">
                      <div className="flex items-center mb-2">
                        <svg className="w-4 h-4 text-gray-500 dark:text-zinc-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h4 className="text-sm font-medium text-gray-700 dark:text-zinc-300">Help: Example Sentence</h4>
                      </div>
                      <div className="text-sm text-gray-600 dark:text-zinc-400">
                        <p className="italic">"{helpContent.sentence}"</p>
                      </div>
                    </div>
                  )}
                  
                  {!showAnswer && (
                    <div className="flex gap-2">
                      <button
                        onClick={handleDefinitionAnswer}
                        disabled={!userGuess.trim()}
                        className="flex-1 px-6 py-3 bg-gradient-to-r from-purple-500 to-purple-600 dark:from-purple-500 dark:to-purple-600 text-white rounded-xl hover:from-purple-600 hover:to-purple-700 dark:hover:from-purple-600 dark:hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-400 dark:disabled:from-zinc-600 dark:disabled:to-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                      >
                        Submit Guess
                      </button>
                      {!helpUsed && (
                        <button
                          onClick={handleHelp}
                          disabled={generatingHelp}
                          className="px-4 py-3 bg-gray-500 dark:bg-zinc-500 text-white rounded-xl hover:bg-gray-600 dark:hover:bg-zinc-600 disabled:bg-gray-400 dark:disabled:bg-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                          title="Get example sentence help"
                        >
                          {generatingHelp ? (
                            <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                          ) : (
                            'Help'
                          )}
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Answer Feedback */}
                {showAnswer && (
                  <div className="space-y-4">
                    <div className={`p-4 rounded-xl border-2 ${
                      definitionScore === 1 
                        ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-zinc-700' 
                        : 'bg-red-50/40 dark:bg-red-500/10 border-red-100/60 dark:border-red-500/20'
                    }`}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                          {definitionScore === 1 ? 'Correct!' : 'Incorrect'}
                        </h4>
                        <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                          definitionScore === 1 
                            ? 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200' 
                            : 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200'
                        }`}>
                          {definitionScore === 1 ? 'Right' : 'Wrong'}
                        </span>
                      </div>
                      
                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="bg-white dark:bg-zinc-800 p-3 rounded-lg border border-gray-100 dark:border-zinc-700">
                          <h5 className="font-medium text-gray-800 dark:text-gray-200 mb-1">
                            Correct Answer
                          </h5>
                          <p className="text-gray-700 dark:text-gray-300">{currentWord}</p>
                        </div>
                        <div className="bg-white dark:bg-zinc-800 p-3 rounded-lg border border-gray-100 dark:border-zinc-700">
                          <h5 className="font-medium text-gray-800 dark:text-gray-200 mb-1">
                            Your Guess
                          </h5>
                          <p className={`${
                            definitionScore === 1 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                          }`}>{userGuess}</p>
                        </div>
                      </div>
                    </div>
                    
                    {disputeResult && (
                      <div className={`p-4 rounded-xl border-2 ${
                        disputeResult.accepted 
                          ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-zinc-700' 
                          : 'bg-gray-50 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-2 h-2 rounded-full ${
                            disputeResult.accepted ? 'bg-blue-500' : 'bg-gray-500'
                          }`}></div>
                          <h5 className="font-medium text-gray-800 dark:text-gray-200">
                            Dispute {disputeResult.accepted ? 'Accepted' : 'Rejected'}
                          </h5>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          {disputeResult.explanation}
                        </p>
                      </div>
                    )}
                    
                    {disputeError && (
                      <div className="p-4 rounded-xl border-2 bg-red-50/40 dark:bg-red-500/10 border-red-100/60 dark:border-red-500/20 mb-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-2 h-2 rounded-full bg-red-500"></div>
                          <h5 className="font-medium text-gray-800 dark:text-gray-200">
                            Dispute Failed
                          </h5>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                          {disputeError}
                        </p>
                        <button
                          onClick={handleDispute}
                          disabled={disputeInProgress}
                          className="px-4 py-3 bg-orange-400 dark:bg-orange-600 text-white rounded-xl hover:bg-orange-500 dark:hover:bg-orange-700 disabled:bg-gray-400 dark:disabled:bg-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                        >
                          {disputeInProgress ? 'Retrying...' : 'Try Again'}
                        </button>
                      </div>
                    )}
                    
                    <div className="flex gap-3">
                      {definitionScore === 0 && !disputeResolved && (
                        <button
                          onClick={handleDispute}
                          disabled={disputeInProgress}
                          className="px-4 py-3 bg-orange-400 dark:bg-orange-600 text-white rounded-xl hover:bg-orange-500 dark:hover:bg-orange-700 disabled:bg-gray-400 dark:disabled:bg-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                          title="Dispute this result - AI will re-evaluate your answer"
                        >
                          {disputeInProgress ? (
                            <div className="flex items-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                              Reviewing...
                            </div>
                          ) : (
                            'Dispute'
                          )}
                        </button>
                      )}
                      <button
                        onClick={handleNextWordDefinition}
                        className="flex-1 px-6 py-4 bg-blue-400 text-white rounded-xl hover:bg-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600 font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl"
                      >
                        Next Word
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-600 dark:text-gray-400">Loading word...</p>
              </div>
            )}
          </div>
        )}

        {/* Combo Mode - Definition + Cloze Sentence Display */}
        {trainingMode === 'combo' && (
          <div className="space-y-6">
            {!geminiApiKey ? (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-300 mb-2">
                  API Key Required
                </h3>
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                  Combo mode requires a Gemini API key to generate definitions and context sentences. Click "Set API Key" above to get started.
                </p>
                <button
                  onClick={() => {
                    setTempApiKey('');
                    setShowApiKeyModal(true);
                  }}
                  className="px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors text-sm font-medium"
                >
                  Set API Key
                </button>
              </div>
            ) : generatingCombo ? (
              <div className="text-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 dark:border-blue-400 border-t-transparent mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-400">Generating combo content...</p>
              </div>
            ) : comboContent ? (
              <div className="space-y-6">
                {/* Question Prompt */}
                <div className="text-left">
                  <h3 className="text-xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
                    Can you guess this word from both the definition and context?
                  </h3>
                </div>

                {/* Definition Section */}
                <div className="bg-gradient-to-br from-emerald-50/30 to-slate-100 dark:bg-gradient-to-br dark:from-emerald-500/5 dark:to-emerald-600/5 p-6 rounded-xl border border-slate-200/60 dark:border-zinc-800">
                  <div className="bg-white dark:bg-zinc-800 p-6 rounded-lg shadow-sm border border-emerald-200 dark:border-zinc-700">
                    <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3">Definition:</h4>
                    {comboContent.partOfSpeech && (
                      <span className="inline-block bg-emerald-100 dark:bg-emerald-800 text-emerald-800 dark:text-emerald-200 px-3 py-1 rounded-full text-sm font-medium mb-3">
                        {comboContent.partOfSpeech}
                      </span>
                    )}
                    <p className="text-lg text-gray-800 dark:text-gray-200 leading-relaxed">
                      {comboContent.definition}
                    </p>
                  </div>
                </div>

                {/* Context Sentence Section */}
                <div className="bg-gradient-to-br from-blue-50/30 to-slate-100 dark:bg-gradient-to-br dark:from-blue-500/5 dark:to-blue-600/5 p-6 rounded-xl border border-slate-200/60 dark:border-zinc-800">
                  <div className="bg-white dark:bg-zinc-800 p-6 rounded-lg shadow-sm border border-blue-200 dark:border-zinc-700">
                    <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-3">Context:</h4>
                    <p className="text-lg text-gray-700 dark:text-gray-300 leading-relaxed italic">
                      "{comboContent.sentence}"
                    </p>
                  </div>
                </div>

                {/* Answer Input */}
                <div className="space-y-4">
                  <input
                    ref={comboModeInputRef}
                    type="text"
                    value={userComboAnswer}
                    onChange={(e) => setUserComboAnswer(e.target.value)}
                    placeholder="Type your guess here..."
                    className="w-full px-4 py-3 border-2 border-gray-200 dark:border-zinc-600 bg-white dark:bg-zinc-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-500 dark:focus:ring-emerald-400 focus:border-transparent text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-zinc-500"
                    disabled={showAnswer}
                  />
                  
                  {!showAnswer && (
                    <button
                      onClick={handleComboAnswer}
                      disabled={!userComboAnswer.trim()}
                      className="w-full px-6 py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 dark:from-emerald-500 dark:to-emerald-600 text-white rounded-xl hover:from-emerald-600 hover:to-emerald-700 dark:hover:from-emerald-600 dark:hover:to-emerald-700 disabled:from-gray-400 disabled:to-gray-400 dark:disabled:from-zinc-600 dark:disabled:to-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                    >
                      Submit Guess
                    </button>
                  )}
                </div>

                {/* Answer Feedback */}
                {showAnswer && (
                  <div className="space-y-4">
                    <div className={`p-4 rounded-xl border-2 ${
                      comboScore === 1 
                        ? 'bg-green-50 dark:bg-green-500/10 border-green-200 dark:border-zinc-700' 
                        : 'bg-red-50/40 dark:bg-red-500/10 border-red-100/60 dark:border-red-500/20'
                    }`}>
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                          {comboScore === 1 ? 'Correct!' : 'Incorrect'}
                        </h4>
                        <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                          comboScore === 1 
                            ? 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200' 
                            : 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200'
                        }`}>
                          {comboScore === 1 ? 'Right' : 'Wrong'}
                        </span>
                      </div>
                      
                      <div className="grid md:grid-cols-2 gap-4">
                        <div className="bg-white dark:bg-zinc-800 p-3 rounded-lg border border-gray-100 dark:border-zinc-700">
                          <h5 className="font-medium text-gray-800 dark:text-gray-200 mb-1">
                            Correct Answer
                          </h5>
                          <p className="text-gray-700 dark:text-gray-300">{currentWord}</p>
                        </div>
                        <div className="bg-white dark:bg-zinc-800 p-3 rounded-lg border border-gray-100 dark:border-zinc-700">
                          <h5 className="font-medium text-gray-800 dark:text-gray-200 mb-1">
                            Your Guess
                          </h5>
                          <p className={`${
                            comboScore === 1 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                          }`}>{userComboAnswer}</p>
                        </div>
                      </div>
                    </div>
                    
                    {disputeResult && (
                      <div className={`p-4 rounded-xl border-2 ${
                        disputeResult.accepted 
                          ? 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-zinc-700' 
                          : 'bg-gray-50 dark:bg-zinc-800 border-gray-200 dark:border-zinc-700'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          <div className={`w-2 h-2 rounded-full ${
                            disputeResult.accepted ? 'bg-blue-500' : 'bg-gray-500'
                          }`}></div>
                          <h5 className="font-medium text-gray-800 dark:text-gray-200">
                            Dispute {disputeResult.accepted ? 'Accepted' : 'Rejected'}
                          </h5>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300">
                          {disputeResult.explanation}
                        </p>
                      </div>
                    )}
                    
                    {disputeError && (
                      <div className="p-4 rounded-xl border-2 bg-red-50/40 dark:bg-red-500/10 border-red-100/60 dark:border-red-500/20 mb-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-2 h-2 rounded-full bg-red-500"></div>
                          <h5 className="font-medium text-gray-800 dark:text-gray-200">
                            Dispute Failed
                          </h5>
                        </div>
                        <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">
                          {disputeError}
                        </p>
                        <button
                          onClick={handleDispute}
                          disabled={disputeInProgress}
                          className="px-4 py-3 bg-orange-400 dark:bg-orange-600 text-white rounded-xl hover:bg-orange-500 dark:hover:bg-orange-700 disabled:bg-gray-400 dark:disabled:bg-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                        >
                          {disputeInProgress ? 'Retrying...' : 'Try Again'}
                        </button>
                      </div>
                    )}
                    
                    <div className="flex gap-3">
                      {comboScore === 0 && !disputeResolved && (
                        <button
                          onClick={handleDispute}
                          disabled={disputeInProgress}
                          className="px-4 py-3 bg-orange-400 dark:bg-orange-600 text-white rounded-xl hover:bg-orange-500 dark:hover:bg-orange-700 disabled:bg-gray-400 dark:disabled:bg-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                          title="Dispute this result - AI will re-evaluate your answer"
                        >
                          {disputeInProgress ? (
                            <div className="flex items-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                              Reviewing...
                            </div>
                          ) : (
                            'Dispute'
                          )}
                        </button>
                      )}
                      <button
                        onClick={handleNextWordCombo}
                        className="flex-1 px-6 py-4 bg-blue-400 text-white rounded-xl hover:bg-blue-500 dark:bg-blue-500 dark:hover:bg-blue-600 font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl"
                      >
                        Next Word
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-600 dark:text-gray-400">Loading word...</p>
              </div>
            )}
          </div>
        )}

        {/* API Key Modal */}
        {showApiKeyModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-black dark:bg-opacity-70 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-zinc-900 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl border border-gray-200 dark:border-zinc-700">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">
                  {geminiApiKey ? 'Update API Key' : 'Set API Key'}
                </h3>
                <button
                  onClick={() => setShowApiKeyModal(false)}
                  className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-xl"
                >
                  ×
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Gemini API Key:
                  </label>
                  <input
                    type="password"
                    value={tempApiKey}
                    onChange={(e) => setTempApiKey(e.target.value)}
                    placeholder="Enter your Gemini API key"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:border-transparent placeholder-gray-400 dark:placeholder-zinc-500"
                  />
                </div>
                
                <div className="bg-gradient-to-br from-blue-50/30 to-slate-100 dark:bg-gradient-to-br dark:from-blue-500/5 dark:to-blue-600/5 p-3 rounded-lg border border-slate-200/60 dark:border-zinc-800">
                  <p className="text-sm text-gray-800 dark:text-gray-300 mb-2">
                    <strong>Get your free API key:</strong>
                  </p>
                  <a 
                    href="https://ai.google.dev/" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:underline text-sm font-medium"
                  >
                    https://ai.google.dev/
                  </a>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                    Your API key is stored locally and never shared.
                  </p>
                </div>
                
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowApiKeyModal(false)}
                    className="flex-1 px-4 py-2 border border-gray-300 dark:border-zinc-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-zinc-800 rounded-lg hover:bg-gray-50 dark:hover:bg-zinc-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setGeminiApiKey(tempApiKey);
                      setShowApiKeyModal(false);
                    }}
                    disabled={!tempApiKey.trim()}
                    className="flex-1 px-4 py-2 bg-blue-600 dark:bg-blue-500 text-white rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 disabled:bg-gray-400 dark:disabled:bg-zinc-600 disabled:cursor-not-allowed transition-colors"
                  >
                    {geminiApiKey ? 'Update' : 'Set'} Key
                  </button>
                </div>
              </div>
              
              {/* Dark Mode Toggle */}
              <div className="mt-6 pt-4 border-t border-gray-200 dark:border-zinc-700">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Dark Mode</span>
                  <button
                    onClick={() => setIsDarkMode(!isDarkMode)}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-blue-400 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 ${
                      isDarkMode ? 'bg-blue-600' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        isDarkMode ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Welcome/Help Modal */}
        {showWelcomeModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 dark:bg-black dark:bg-opacity-70 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-zinc-900 rounded-xl p-8 max-w-3xl w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-zinc-700">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-3xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 dark:from-slate-200 dark:to-slate-400 bg-clip-text text-transparent">
                  Welcome to Fluency Trainer
                </h2>
                <button
                  onClick={() => setShowWelcomeModal(false)}
                  className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-2xl font-bold"
                >
                  ×
                </button>
              </div>
              
              <div className="space-y-6 text-slate-700 dark:text-slate-300">
                <p className="text-lg leading-relaxed text-center">
                  Train your <strong>spoken fluency</strong> by practicing those frustrating "tip of the tongue" moments. 
                  You know the concept, but can you find the word?
                </p>

                <div>
                  <h3 className="text-xl font-bold mb-4 text-slate-800 dark:text-slate-200 text-center">Four Training Modes</h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 rounded-lg border bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-500/5 dark:to-blue-500/10 border-blue-200/50 dark:border-blue-500/20">
                      <h4 className="font-bold mb-1 flex items-center text-gray-900 dark:text-white">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.031 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                        Normal Mode
                      </h4>
                      <p className="text-sm mb-3 text-gray-700 dark:text-gray-300">Fill in the blanks - classic "tip of the tongue" training</p>
                      <div className="text-sm bg-white dark:bg-zinc-800 p-3 rounded border">
                        <p className="italic text-slate-600 dark:text-slate-400">"The _____ was so loud it woke everyone up."</p>
                        <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">Definition: A sudden loud noise</p>
                      </div>
                    </div>
                    
                    <div className="p-4 rounded-lg border bg-gradient-to-br from-sky-50 to-sky-100 dark:from-sky-500/5 dark:to-sky-500/10 border-sky-200/50 dark:border-sky-500/20">
                      <h4 className="font-bold mb-1 flex items-center text-gray-900 dark:text-white">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        Reverse Mode
                      </h4>
                      <p className="text-sm mb-3 text-gray-700 dark:text-gray-300">Surprisingly hard! AI grades your definitions</p>
                      <div className="text-sm bg-white dark:bg-zinc-800 p-3 rounded border">
                        <p className="font-medium">Define: <span className="text-gray-800 dark:text-gray-200">Serendipity</span></p>
                        <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">Your turn to be the dictionary!</p>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg border bg-gradient-to-br from-cyan-50 to-cyan-100 dark:from-cyan-500/5 dark:to-cyan-500/10 border-cyan-200/50 dark:border-cyan-500/20">
                      <h4 className="font-bold mb-1 flex items-center text-gray-900 dark:text-white">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        Definition Mode
                      </h4>
                      <p className="text-sm mb-3 text-gray-700 dark:text-gray-300">Classic word game that builds vocabulary</p>
                      <div className="text-sm bg-white dark:bg-zinc-800 p-3 rounded border">
                        <p className="italic text-slate-600 dark:text-slate-400">"A feeling of great happiness and excitement"</p>
                        <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">What word am I?</p>
                      </div>
                    </div>

                    <div className="p-4 rounded-lg border bg-gradient-to-br from-teal-50 to-teal-100 dark:from-teal-500/5 dark:to-teal-500/10 border-teal-200/50 dark:border-teal-500/20">
                      <h4 className="font-bold mb-1 flex items-center text-gray-900 dark:text-white">
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        Combo Mode
                      </h4>
                      <p className="text-sm mb-3 text-gray-700 dark:text-gray-300">Definition + context = maximum clarity</p>
                      <div className="text-sm bg-white dark:bg-zinc-800 p-3 rounded border">
                        <p className="italic text-slate-600 dark:text-slate-400">"To make something less intense"</p>
                        <p className="text-slate-600 dark:text-slate-400">"The music helped _____ her anxiety."</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-100 dark:bg-zinc-800 p-5 rounded-lg border border-slate-300 dark:border-zinc-700">
                  <h3 className="text-lg font-bold mb-3 text-slate-800 dark:text-slate-200 flex items-center">
                    <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    Quick Start
                  </h3>
                  <div className="space-y-2">
                    <p className="text-slate-800 dark:text-slate-200">
                      <strong>1.</strong> Get your free API key: <a href="https://ai.google.dev/" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 underline font-medium">Google AI Studio</a>
                    </p>
                    <p className="text-slate-800 dark:text-slate-200">
                      <strong>2.</strong> Click the settings ⚙️ to add your key
                    </p>
                    <p className="text-slate-800 dark:text-slate-200">
                      <strong>3.</strong> Start training your fluency!
                    </p>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-zinc-800/50 p-4 rounded-lg border border-slate-200 dark:border-zinc-700/50">
                  <h3 className="text-sm font-bold mb-2 text-slate-800 dark:text-slate-200 flex items-center">
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    More Info
                  </h3>
                  <div className="text-sm text-slate-600 dark:text-slate-400 space-y-2">
                    <p><strong>The idea:</strong> Fluency likely improves through active word retrieval practice rather than just reading. This gamifies those "tip of the tongue" moments to potentially strengthen mental connections.</p>
                    <p><strong>The challenge:</strong> A scoring system adjusts word rarity based on your performance - nail the tricky ones and face even rarer vocabulary!</p>
                    <p><strong>Pro tip:</strong> Press Enter to submit and move to the next word.</p>
                  </div>
                </div>
              </div>
              
              <div className="flex justify-center mt-6">
                <button
                  onClick={() => setShowWelcomeModal(false)}
                  className="px-8 py-3 bg-gradient-to-r from-slate-800 to-slate-700 dark:from-slate-700 dark:to-slate-600 text-white rounded-lg hover:from-slate-700 hover:to-slate-600 dark:hover:from-slate-600 dark:hover:to-slate-500 transition-all font-medium text-lg shadow-lg"
                >
                  Let's Go!
                </button>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default ZipfTrainer;