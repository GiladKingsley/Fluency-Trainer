import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  } = getInitialState();
  const [zipfLevels, setZipfLevels] = useState(initialZipfLevels);
  const [trainingMode, setTrainingMode] = useState(initialMode);
  const [geminiApiKey, setGeminiApiKey] = useState(initialGeminiKey);
  
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

  // API Key modal state
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  
  // Welcome modal state
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);

  const normalModeInputRef = useRef(null);
  const reverseModeInputRef = useRef(null);
  const definitionModeInputRef = useRef(null);

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

  const generateClozeTest = useCallback(async (word) => {
    if (!geminiApiKey) {
      return null;
    }

    setGeneratingCloze(true);
    
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `You are an AI that creates high-quality cloze-test exercises for a given English word. Your purpose is to help adults train their language fluency by testing the same word in different contexts.

You will be given a word in \`<word>\` tags. Your response must follow these strict rules:

**1. Valid Word Handling:**
- For any valid English word, you must create exactly TWO separate sentences, each showing the target word in a different context.
- Each sentence must be enclosed in its own \`<sentence1>\` and \`<sentence2>\` tags.
- In each sentence, include the target word naturally in its proper location.
- The two sentences should demonstrate different meanings, uses, or contexts of the same word.
- **Example:** For the word "bank", a valid output would be:
\`<sentence1>After receiving her paycheck, Sarah walked to the bank to deposit the money into her savings account.</sentence1>
<sentence2>The children enjoyed their picnic on the grassy bank of the river while watching the ducks swim by.</sentence2>\`

**2. Invalid Word Handling:**
- If the input is not a real English word, your entire output must be the exact text \`NOT_A_WORD\`.
- Do not use any tags for this output.
- Invalid words include:
    - Numbers (e.g., "5", "123")
    - Single letters (e.g., "s", "x")
    - Symbols (e.g., "&", "@")
    - Random character combinations (e.g., "pvzr")
    - Malformed words (e.g., "thing's", "w8")
    - Most personal names or obscure trademarks (e.g., "Isabella", "Noah")
- **Exception:** You may treat widely known place names with cultural significance as valid words (e.g., "hollywood", "paris").

**3. Sentence Quality Requirements:**
- **Two distinct contexts:** Each sentence should show the word in a meaningfully different context or usage.
- **Unambiguous:** Each sentence's context must strongly point to the target word, leaving no room for synonyms or other plausible words.
- **Exact Match:** The target word should appear exactly as provided in the original word.
- **Longer and descriptive:** Each sentence should be substantial (10+ words) and include descriptive details that make the context very clear.
- **Independent:** Each sentence should be completely independent and understandable on its own.
- **No Synonyms:** Do not use synonyms of the target word within either sentence.

<word>${word}</word>`
              }]
            }]
          })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to generate cloze test');
      }

      const data = await response.json();
      const text = data.candidates[0].content.parts[0].text.trim();
      
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
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `You are an AI that creates Oxford Dictionary-style definitions for English words. Your purpose is to help adults train their vocabulary by providing clear, precise definitions for word guessing exercises.

You will be given a word in \`<word>\` tags. Your response must follow these strict rules:

**1. Valid Word Handling:**
- For any valid English word, you must create a clear, concise definition in the style of the Oxford English Dictionary.
- The definition must be enclosed in \`<definition>\` tags.
- The part of speech must be enclosed in \`<pos>\` tags at the beginning.
- The definition should be 1-3 sentences long and capture the most common meaning of the word.
- Use simple, clear language that would help someone identify the word without being too obvious.
- Do NOT include the target word or its root form in the definition.
- **Example:** For the word "telescope", a valid output would be:
\`<pos>noun</pos>
<definition>An optical instrument designed to make distant objects appear nearer and larger by using lenses or mirrors to collect and focus light.</definition>\`

**2. Invalid Word Handling:**
- If the input is not a real English word, your entire output must be the exact text \`NOT_A_WORD\`.
- Do not use any tags for this output.
- Invalid words include:
    - Numbers (e.g., "5", "123")
    - Single letters (e.g., "s", "x")
    - Symbols (e.g., "&", "@")
    - Random character combinations (e.g., "pvzr")
    - Malformed words (e.g., "thing's", "w8")
    - Most personal names or obscure trademarks (e.g., "Isabella", "Noah")
- **Exception:** You may treat widely known place names with cultural significance as valid words (e.g., "hollywood", "paris").

**3. Definition Quality Requirements:**
- **Clear and precise:** The definition should be unambiguous and help identify the specific word.
- **Appropriate difficulty:** Not too obvious, but not so obscure that it's impossible to guess.
- **Standard format:** Use formal dictionary language.
- **Complete:** Provide enough information to distinguish this word from similar concepts.
- **Avoid circular definitions:** Don't use the word itself or obvious derivatives.

<word>${word}</word>`
              }]
            }]
          })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to generate definition');
      }

      const data = await response.json();
      const text = data.candidates[0].content.parts[0].text.trim();
      
      if (text === 'NOT_A_WORD') {
        return 'NOT_A_WORD';
      }
      
      // Extract part of speech and definition from tags
      const posMatch = text.match(/<pos>(.*?)<\/pos>/s);
      const definitionMatch = text.match(/<definition>(.*?)<\/definition>/s);
      
      if (posMatch && definitionMatch) {
        return {
          partOfSpeech: posMatch[1].trim(),
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
      const randomWord = wordsInRange[Math.floor(Math.random() * wordsInRange.length)];
      
      try {
        const clozeResult = await generateClozeTest(randomWord);
        if (clozeResult === 'NOT_A_WORD') {
          attempts++;
          continue; // Try another word
        }
        
        setCurrentWord(randomWord);
        setClozeTest(clozeResult);
        setUserAnswer('');
        setNormalScore(null);
        setShowAnswer(false);
        return;
      } catch (error) {
        attempts++;
        if (attempts === maxAttempts) {
          console.error('Failed to generate cloze test after', maxAttempts, 'attempts');
          return;
        }
      }
    }
  }, [wordData, normalZipfLevel, generateClozeTest, getWordsInZipfRange]);

  const selectNewWordReverse = useCallback(() => {
    if (!wordData) return;

    const wordsInRange = getWordsInZipfRange(reverseZipfLevel);
    if (wordsInRange.length === 0) {
      console.error('No words found in range');
      return;
    }

    const randomWord =
      wordsInRange[Math.floor(Math.random() * wordsInRange.length)];
    
    setCurrentWord(randomWord);
    setUserDefinition('');
    setScore(null);
    setCorrectDefinition('');
    setShowAnswer(false);
  }, [wordData, reverseZipfLevel, getWordsInZipfRange]);

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
      const randomWord = wordsInRange[Math.floor(Math.random() * wordsInRange.length)];
      
      try {
        const definitionResult = await generateDefinition(randomWord);
        if (definitionResult === 'NOT_A_WORD') {
          attempts++;
          continue; // Try another word
        }
        
        setCurrentWord(randomWord);
        setWordDefinition(definitionResult);
        setUserGuess('');
        setDefinitionScore(null);
        setShowAnswer(false);
        return;
      } catch (error) {
        attempts++;
        if (attempts === maxAttempts) {
          console.error('Failed to generate definition after', maxAttempts, 'attempts');
          return;
        }
      }
    }
  }, [wordData, definitionZipfLevel, generateDefinition, getWordsInZipfRange]);

  const selectNewWord = useCallback(async () => {
    if (!wordData) return;

    if (trainingMode === 'reverse') {
      selectNewWordReverse();
    } else if (trainingMode === 'definition') {
      await selectNewWordDefinition();
    } else {
      await selectNewWordNormal();
    }
  }, [wordData, trainingMode, selectNewWordReverse, selectNewWordDefinition, selectNewWordNormal]);

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
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite-preview-06-17:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `I am in a fluency trainer app. For the given word and user's definition, I need to:
1. First provide a concise, accurate definition of the word in <definition> tags
2. Then grade the user's definition from 1 to 5 in <grade> tags

If a word has multiple definitions, and the user defined one that wasn't in your mind or you weren't planning on asking about, grade them for the meaning they were trying to define instead of the other one you wanted to grade them on.

**Grading Rubric:**
*   **1: Irrelevant.** The definition is completely wrong or unrelated.
*   **2: Not There** Touches upon a related concept but misses the core meaning AND/OR uses the root of the word or the word itself in the definition.
*   **3: Alright** The main concept is correct, but the definition is imperfect. A smart individual would understand the description matches the word.
*   **4: Accurate.** A solid, correct definition that shows good understanding.
*   **5: Precise & Nuanced.** A comprehensive, almost dictionary-quality definition.

Respond ONLY with the definition and grade in the specified tags, nothing else.

Word: ${word}
User's definition: ${userDef}`
              }]
            }]
          })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to grade definition');
      }

      const data = await response.json();
      const text = data.candidates[0].content.parts[0].text;
      
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
  };

  const handleNextWordNormal = useCallback(() => {
    // Apply difficulty adjustment based on the current score
    if (normalScore !== null) {
      if (normalScore === 1) {
        // Correct - make it harder (lower Zipf)
        setNormalZipfLevel(prev => prev - ZIPF_ADJUSTMENT);
      } else {
        // Incorrect - make it easier (higher Zipf)
        setNormalZipfLevel(prev => prev + ZIPF_ADJUSTMENT);
      }
    }
    
    // Select new word
    selectNewWord();
  }, [normalScore, selectNewWord]);

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
    // Apply difficulty adjustment based on the current score
    if (definitionScore !== null) {
      if (definitionScore === 1) {
        // Correct - make it harder (lower Zipf)
        setDefinitionZipfLevel(prev => prev - ZIPF_ADJUSTMENT);
      } else {
        // Incorrect - make it easier (higher Zipf)
        setDefinitionZipfLevel(prev => prev + ZIPF_ADJUSTMENT);
      }
    }
    
    // Select new word
    selectNewWord();
  }, [definitionScore, selectNewWord]);

  const handleDefinitionAnswer = useCallback(() => {
    if (!userGuess.trim()) return;
    
    const correct = isAnswerCorrect(userGuess, currentWord);
    setDefinitionScore(correct ? 1 : 0);
    setShowAnswer(true);
    // Don't adjust difficulty here - wait for user to click "Next Word"
  }, [userGuess, currentWord, isAnswerCorrect]);

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
          <div className="flex gap-2 mb-4 p-1 bg-gray-100 dark:bg-zinc-800 rounded-lg">
            <button
              onClick={() => handleModeChange('normal')}
              className={`flex-1 px-4 py-3 rounded-md font-medium transition-all duration-200 ${trainingMode === 'normal' 
                ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                : 'text-gray-600 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'}`}
            >
              Normal Mode
              <div className="text-xs opacity-75">Context → Word</div>
            </button>
            <button
              onClick={() => handleModeChange('reverse')}
              className={`flex-1 px-4 py-3 rounded-md font-medium transition-all duration-200 ${trainingMode === 'reverse' 
                ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                : 'text-gray-600 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'}`}
            >
              Reverse Mode
              <div className="text-xs opacity-75">Word → Definition</div>
            </button>
            <button
              onClick={() => handleModeChange('definition')}
              className={`flex-1 px-4 py-3 rounded-md font-medium transition-all duration-200 ${trainingMode === 'definition' 
                ? 'bg-white dark:bg-zinc-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                : 'text-gray-600 dark:text-zinc-400 hover:text-gray-800 dark:hover:text-zinc-200'}`}
            >
              Definition Mode
              <div className="text-xs opacity-75">Definition → Word</div>
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
              <div className="space-y-4">
                {/* Both Sentences Display */}
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 p-6 rounded-xl border border-blue-100 dark:border-blue-800">
                  <h3 className="text-lg font-medium text-gray-800 dark:text-gray-200 mb-4">
                    Fill in the blanks with the same word:
                  </h3>
                  
                  {typeof clozeTest === 'object' ? (
                    <div className="space-y-4">
                      <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-gray-200 dark:border-zinc-700">
                        <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Sentence 1:</div>
                        <p className="text-lg text-gray-700 dark:text-gray-300 leading-relaxed">
                          {clozeTest.sentence1}
                        </p>
                      </div>
                      
                      <div className="bg-white dark:bg-zinc-800 p-4 rounded-lg border border-gray-200 dark:border-zinc-700">
                        <div className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2">Sentence 2:</div>
                        <p className="text-lg text-gray-700 dark:text-gray-300 leading-relaxed">
                          {clozeTest.sentence2}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xl text-gray-700 dark:text-gray-300 leading-relaxed">
                      {clozeTest}
                    </p>
                  )}
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
                  
                  {!showAnswer && (
                    <button
                      onClick={handleNormalAnswer}
                      disabled={!userAnswer.trim()}
                      className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 dark:from-blue-500 dark:to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 dark:hover:from-blue-600 dark:hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-400 dark:disabled:from-zinc-600 dark:disabled:to-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                    >
                      Submit Answer
                    </button>
                  )}
                </div>

                {/* Answer Feedback */}
                {showAnswer && (
                  <div className="space-y-4">
                    <div className={`p-4 rounded-xl border-2 ${
                      normalScore === 1 
                        ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border-green-200 dark:border-green-800' 
                        : 'bg-gradient-to-r from-red-50 to-pink-50 dark:from-red-950/30 dark:to-pink-950/30 border-red-200 dark:border-red-800'
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
                    
                    <button
                      onClick={handleNextWordNormal}
                      className="w-full px-6 py-4 bg-gradient-to-r from-indigo-500 to-purple-600 dark:from-indigo-500 dark:to-purple-600 text-white rounded-xl hover:from-indigo-600 hover:to-purple-700 dark:hover:from-indigo-600 dark:hover:to-purple-700 font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl"
                    >
                      Next Word
                    </button>
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
            <div className="text-center bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 p-8 rounded-xl border border-blue-100 dark:border-blue-800">
              <div className="inline-block bg-white dark:bg-zinc-800 px-6 py-3 rounded-lg shadow-sm border border-blue-200 dark:border-blue-700 mb-4">
                <h2 className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                  {currentWord}
                </h2>
              </div>
              <p className="text-lg text-gray-700 dark:text-gray-300">
                How would you define this word?
              </p>
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
                    ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border-green-200 dark:border-green-800' 
                    : 'bg-gradient-to-r from-red-50 to-pink-50 dark:from-red-950/30 dark:to-pink-950/30 border-red-200 dark:border-red-800'
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
                      {score >= 3 ? 'Correct!' : 'Keep Trying'}
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
                  className="w-full px-6 py-4 bg-gradient-to-r from-indigo-500 to-purple-600 dark:from-indigo-500 dark:to-purple-600 text-white rounded-xl hover:from-indigo-600 hover:to-purple-700 dark:hover:from-indigo-600 dark:hover:to-purple-700 font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl"
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
                <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-950/30 dark:to-indigo-950/30 p-6 rounded-xl border border-purple-100 dark:border-purple-800">
                  <div className="bg-white dark:bg-zinc-800 p-6 rounded-lg shadow-sm border border-purple-200 dark:border-purple-700">
                    {/* Display part of speech and definition */}
                    {typeof wordDefinition === 'object' && wordDefinition.partOfSpeech ? (
                      <>
                        <div className="mb-3">
                          <span className="inline-block bg-purple-100 dark:bg-purple-800 text-purple-800 dark:text-purple-200 px-3 py-1 rounded-full text-sm font-medium">
                            {wordDefinition.partOfSpeech}
                          </span>
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
                  
                  {!showAnswer && (
                    <button
                      onClick={handleDefinitionAnswer}
                      disabled={!userGuess.trim()}
                      className="w-full px-6 py-3 bg-gradient-to-r from-purple-500 to-purple-600 dark:from-purple-500 dark:to-purple-600 text-white rounded-xl hover:from-purple-600 hover:to-purple-700 dark:hover:from-purple-600 dark:hover:to-purple-700 disabled:from-gray-400 disabled:to-gray-400 dark:disabled:from-zinc-600 dark:disabled:to-zinc-600 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
                    >
                      Submit Guess
                    </button>
                  )}
                </div>

                {/* Answer Feedback */}
                {showAnswer && (
                  <div className="space-y-4">
                    <div className={`p-4 rounded-xl border-2 ${
                      definitionScore === 1 
                        ? 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border-green-200 dark:border-green-800' 
                        : 'bg-gradient-to-r from-red-50 to-pink-50 dark:from-red-950/30 dark:to-pink-950/30 border-red-200 dark:border-red-800'
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
                    
                    <button
                      onClick={handleNextWordDefinition}
                      className="w-full px-6 py-4 bg-gradient-to-r from-indigo-500 to-purple-600 dark:from-indigo-500 dark:to-purple-600 text-white rounded-xl hover:from-indigo-600 hover:to-purple-700 dark:hover:from-indigo-600 dark:hover:to-purple-700 font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl"
                    >
                      Next Word
                    </button>
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
                
                <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-sm text-blue-800 dark:text-blue-300 mb-2">
                    <strong>Get your free API key:</strong>
                  </p>
                  <a 
                    href="https://ai.google.dev/" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
                  >
                    https://ai.google.dev/
                  </a>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
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
            <div className="bg-white dark:bg-zinc-900 rounded-xl p-8 max-w-2xl w-full mx-4 shadow-2xl max-h-[90vh] overflow-y-auto border border-gray-200 dark:border-zinc-700">
              <div className="flex justify-between items-center mb-8">
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
              
              <div className="space-y-8 text-slate-700 dark:text-slate-300">
                <div>
                  <p className="text-lg mb-4 leading-relaxed">
                    Enhance your <strong>spoken fluency</strong> by practicing active word retrieval. This app goes beyond passive reading to train your ability to produce language efficiently.
                  </p>
                </div>

                <div>
                  <h3 className="text-xl font-bold mb-4 text-slate-800 dark:text-slate-200">Three Training Modes</h3>
                  
                  <div className="space-y-4">
                    <div className="bg-slate-50 dark:bg-zinc-800 p-5 rounded-lg border border-slate-200 dark:border-zinc-700">
                      <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-3">Normal Mode (Cloze Tests)</h4>
                      <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                        Fill in the blanks in two sentences that use the same word in different contexts. This trains your ability to recognize words in various situations and strengthens mental connections between concepts and vocabulary.
                      </p>
                    </div>
                    
                    <div className="bg-slate-50 dark:bg-zinc-800 p-5 rounded-lg border border-slate-200 dark:border-zinc-700">
                      <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-3">Reverse Mode (Word → Definition)</h4>
                      <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                        Define words and get AI-powered feedback. Uses Google's Gemini AI to evaluate your definitions with detailed scoring (1-5) and helps you understand concepts more deeply.
                      </p>
                    </div>

                    <div className="bg-slate-50 dark:bg-zinc-800 p-5 rounded-lg border border-slate-200 dark:border-zinc-700">
                      <h4 className="font-bold text-slate-800 dark:text-slate-200 mb-3">Definition Mode (Definition → Word)</h4>
                      <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                        Guess words from Oxford Dictionary-style definitions. Improves your vocabulary recognition and helps you connect formal definitions to everyday words you know.
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-xl font-bold mb-4 text-slate-800 dark:text-slate-200">Adaptive Difficulty</h3>
                  <p className="leading-relaxed mb-3">
                    The app automatically adjusts word difficulty based on your performance using scientific word frequency data:
                  </p>
                  <ul className="ml-6 space-y-2 leading-relaxed">
                    <li><strong>Success:</strong> You'll face rarer, more challenging words</li>
                    <li><strong>Struggle:</strong> The app provides more common, easier words</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-xl font-bold mb-4 text-slate-800 dark:text-slate-200">Getting Started</h3>
                  <div className="bg-slate-100 dark:bg-zinc-800 p-5 rounded-lg border border-slate-300 dark:border-zinc-700">
                    <p className="text-slate-800 dark:text-slate-200 mb-3 leading-relaxed">
                      <strong>First:</strong> Get your free Gemini API key from <a href="https://ai.google.dev/" target="_blank" rel="noopener noreferrer" className="text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 underline font-medium">Google AI Studio</a>
                    </p>
                    <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                      <strong>Then:</strong> Click the settings gear in the top-right to add your API key and start training!
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="flex justify-center mt-8">
                <button
                  onClick={() => setShowWelcomeModal(false)}
                  className="px-8 py-3 bg-slate-800 dark:bg-slate-700 text-white rounded-lg hover:bg-slate-700 dark:hover:bg-slate-600 transition-colors font-medium text-lg"
                >
                  Start Training
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
