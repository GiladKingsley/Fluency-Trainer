import React, { useState, useEffect, useCallback } from 'react';
//please work lol
const ZIPF_ADJUSTMENT = 0.05;
const ZIPF_RANGE = 0.1;
const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb'];

const getInitialState = () => {
  const savedPreferences = localStorage.getItem('displayPreferences');
  const savedZipfLevels = localStorage.getItem('zipfLevels');
  const savedPartsOfSpeech = localStorage.getItem('activePartsOfSpeech');
  const savedMode = localStorage.getItem('trainingMode');
  const savedGeminiKey = localStorage.getItem('geminiApiKey');

  return {
    displayPreferences: savedPreferences
      ? JSON.parse(savedPreferences)
      : {
          showExamples: false,
          showSynonyms: false,
        },
    zipfLevels: savedZipfLevels
      ? JSON.parse(savedZipfLevels)
      : {
          noun: 5.0,
          verb: 5.0,
          adjective: 5.0,
          adverb: 5.0,
          default: 5.0,
        },
    activePartsOfSpeech: savedPartsOfSpeech
      ? JSON.parse(savedPartsOfSpeech)
      : PARTS_OF_SPEECH,
    trainingMode: savedMode || 'normal',
    geminiApiKey: savedGeminiKey || '',
  };
};

const ZipfTrainer = () => {
  const [wordData, setWordData] = useState(null);
  const [currentWord, setCurrentWord] = useState(null);
  const [currentPartOfSpeech, setCurrentPartOfSpeech] = useState(null);
  const [definitions, setDefinitions] = useState([]);
  const [currentDefIndex, setCurrentDefIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAnswer, setShowAnswer] = useState(false);

  // Get initial state from localStorage or defaults
  const {
    displayPreferences: initialPreferences,
    zipfLevels: initialZipfLevels,
    activePartsOfSpeech: initialActivePos,
    trainingMode: initialMode,
    geminiApiKey: initialGeminiKey,
  } = getInitialState();
  const [displayPreferences, setDisplayPreferences] =
    useState(initialPreferences);
  const [zipfLevels, setZipfLevels] = useState(initialZipfLevels);
  const [activePartsOfSpeech, setActivePartsOfSpeech] =
    useState(initialActivePos);
  const [trainingMode, setTrainingMode] = useState(initialMode);
  const [geminiApiKey, setGeminiApiKey] = useState(initialGeminiKey);
  
  // Reverse mode state
  const [userDefinition, setUserDefinition] = useState('');
  const [score, setScore] = useState(null);
  const [correctDefinition, setCorrectDefinition] = useState('');
  const [grading, setGrading] = useState(false);
  const [reverseZipfLevel, setReverseZipfLevel] = useState(5.0);

  const getWordsInZipfRange = useCallback(() => {
    if (!wordData) return [];

    const targetZipf = zipfLevels[currentPartOfSpeech || 'default'];
    const minZipf = targetZipf - ZIPF_RANGE / 2;
    const maxZipf = targetZipf + ZIPF_RANGE / 2;

    return Object.entries(wordData)
      .filter(
        ([_, data]) => data.zipf >= minZipf && data.zipf <= maxZipf,
      )
      .map(([word]) => word);
  }, [wordData, zipfLevels, currentPartOfSpeech]);

  const fetchWordDefinition = useCallback(
    async (word) => {
      try {
        const response = await fetch(
          `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`,
        );

        if (!response.ok) {
          throw new Error('Word not found');
        }

        const data = await response.json();

        // Filter meanings to only include active parts of speech
        let availableMeanings = data[0].meanings.filter((m) =>
          activePartsOfSpeech.includes(m.partOfSpeech),
        );

        // If no meanings match our active parts of speech, try another word
        if (availableMeanings.length === 0) {
          throw new Error('No matching parts of speech');
        }

        // Set the part of speech for this word
        setCurrentPartOfSpeech(availableMeanings[0].partOfSpeech);

        // Collect definitions
        const allDefinitions = availableMeanings.flatMap((meaning) =>
          meaning.definitions.map((def) => ({
            definition: def.definition,
            partOfSpeech: meaning.partOfSpeech,
            example: def.example,
            synonyms: meaning.synonyms,
          })),
        );

        setDefinitions(allDefinitions);
        setCurrentDefIndex(0);
      } catch (error) {
        console.error('Error fetching definition:', error);
        throw error; // Let selectNewWord handle the retry
      }
    },
    [activePartsOfSpeech],
  );

  const selectNewWordReverse = useCallback(() => {
    if (!wordData) return;

    const targetZipf = reverseZipfLevel;
    const minZipf = targetZipf - ZIPF_RANGE / 2;
    const maxZipf = targetZipf + ZIPF_RANGE / 2;

    const wordsInRange = Object.entries(wordData)
      .filter(
        ([_, data]) => data.zipf >= minZipf && data.zipf <= maxZipf,
      )
      .map(([word]) => word);

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
  }, [wordData, reverseZipfLevel]);

  const selectNewWord = useCallback(async () => {
    if (!wordData) return;

    if (trainingMode === 'reverse') {
      selectNewWordReverse();
      return;
    }

    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const wordsInRange = getWordsInZipfRange();
      if (wordsInRange.length === 0) {
        console.error('No words found in range');
        return;
      }

      const randomWord =
        wordsInRange[Math.floor(Math.random() * wordsInRange.length)];

      try {
        setCurrentWord(randomWord);
        setShowAnswer(false);
        await fetchWordDefinition(randomWord);
        return; // Success!
      } catch (error) {
        attempts++;
        if (attempts === maxAttempts) {
          console.error(
            'Failed to find suitable word after',
            maxAttempts,
            'attempts',
          );
          return;
        }
      }
    }
  }, [wordData, getWordsInZipfRange, fetchWordDefinition, trainingMode, selectNewWordReverse]);

  // Load word frequency data
  useEffect(() => {
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
        setWordData(data.words);
        setLoading(false);
      })
      .catch(() => {
        // Fallback to dev path
        fetch(devPath)
          .then((response) => response.json())
          .then((data) => {
            setWordData(data.words);
            setLoading(false);
          })
          .catch((error) => {
            console.error('Error loading word data:', error);
            setLoading(false);
          });
      });
  }, []);

  // Save state to localStorage
  useEffect(() => {
    localStorage.setItem(
      'displayPreferences',
      JSON.stringify(displayPreferences),
    );
  }, [displayPreferences]);

  useEffect(() => {
    localStorage.setItem('zipfLevels', JSON.stringify(zipfLevels));
  }, [zipfLevels]);

  useEffect(() => {
    localStorage.setItem(
      'activePartsOfSpeech',
      JSON.stringify(activePartsOfSpeech),
    );
  }, [activePartsOfSpeech]);

  useEffect(() => {
    localStorage.setItem('trainingMode', trainingMode);
  }, [trainingMode]);

  useEffect(() => {
    localStorage.setItem('geminiApiKey', geminiApiKey);
  }, [geminiApiKey]);

  // Select new word when relevant state changes
  useEffect(() => {
    if (!loading && wordData) {
      selectNewWord();
    }
  }, [loading, wordData, zipfLevels, activePartsOfSpeech, trainingMode, selectNewWord]);

  const gradeDefinition = useCallback(async (word, userDef) => {
    if (!geminiApiKey) {
      alert('Please enter your Gemini API key to use reverse mode');
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

**Grading Rubric:**
*   **1: Irrelevant.** The definition is completely wrong or unrelated.
*   **2: Vaguely Related.** Touches upon a related concept but misses the core meaning.
*   **3: Core Idea.** The main concept is correct, but the definition is imperfect. A smart individual would understand the description matches the word.
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

  const handleDifficulty = (harder) => {
    const pos = currentPartOfSpeech || 'default';
    // Higher Zipf = easier words, so "harder" button should decrease Zipf
    setZipfLevels((prev) => ({
      ...prev,
      [pos]: harder
        ? prev[pos] - ZIPF_ADJUSTMENT  // Make harder (lower Zipf)
        : prev[pos] + ZIPF_ADJUSTMENT, // Make easier (higher Zipf)
    }));
  };

  const togglePartOfSpeech = (pos) => {
    setActivePartsOfSpeech((prev) => {
      if (prev.includes(pos)) {
        // Don't allow removing last part of speech
        if (prev.length === 1) return prev;
        return prev.filter((p) => p !== pos);
      } else {
        return [...prev, pos];
      }
    });
  };

  const togglePreference = (key) => {
    setDisplayPreferences((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleModeChange = (mode) => {
    setTrainingMode(mode);
    // Reset state when changing modes
    setShowAnswer(false);
    setUserDefinition('');
    setScore(null);
    setCorrectDefinition('');
  };

  const handleNextWordReverse = () => {
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
  };

  if (loading) {
    return <div className="text-center py-8">Loading word data...</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8">
      <div className="max-w-2xl mx-auto p-4">
        <div className="bg-white rounded-xl shadow-lg p-6 border border-gray-100">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">Fluency Trainer</h1>
          <p className="text-gray-600">Improve your vocabulary and definition skills</p>
        </div>

        {/* Mode Selection */}
        <div className="mb-6">
          <div className="flex gap-2 mb-4 p-1 bg-gray-100 rounded-lg">
            <button
              onClick={() => handleModeChange('normal')}
              className={`flex-1 px-4 py-3 rounded-md font-medium transition-all duration-200 ${trainingMode === 'normal' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'text-gray-600 hover:text-gray-800'}`}
            >
              Normal Mode
              <div className="text-xs opacity-75">Definition → Word</div>
            </button>
            <button
              onClick={() => handleModeChange('reverse')}
              className={`flex-1 px-4 py-3 rounded-md font-medium transition-all duration-200 ${trainingMode === 'reverse' 
                ? 'bg-white text-blue-600 shadow-sm' 
                : 'text-gray-600 hover:text-gray-800'}`}
            >
              Reverse Mode
              <div className="text-xs opacity-75">Word → Definition</div>
            </button>
          </div>
          
          {/* Gemini API Key Input for Reverse Mode - Only show if not set */}
          {trainingMode === 'reverse' && !geminiApiKey && (
            <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <h3 className="text-sm font-medium text-yellow-800 mb-2">
                API Key Required
              </h3>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Enter your Gemini API Key to start:
              </label>
              <input
                type="password"
                value={geminiApiKey}
                onChange={(e) => setGeminiApiKey(e.target.value)}
                placeholder="Enter your Gemini API key"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-2">
                Get your free API key from: <a href="https://ai.google.dev/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">https://ai.google.dev/</a>
              </p>
            </div>
          )}
        </div>

        {/* Settings and Zipf Level */}
        <div className="flex flex-col gap-4 mb-6">
          <div className="flex justify-between items-center">
            {trainingMode === 'normal' && (
              <div className="space-x-4">
                {/* Toggle for Show Examples */}
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={displayPreferences.showExamples}
                    onChange={() => togglePreference('showExamples')}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                  <span className="ms-3 text-sm font-medium text-gray-900 dark:text-gray-300">
                    Show Examples
                  </span>
                </label>

                {/* Toggle for Show Synonyms */}
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={displayPreferences.showSynonyms}
                    onChange={() => togglePreference('showSynonyms')}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                  <span className="ms-3 text-sm font-medium text-gray-900 dark:text-gray-300">
                    Show Synonyms
                  </span>
                </label>
              </div>
            )}
            <div className="bg-gray-50 px-3 py-2 rounded-lg">
              <div className="text-xs text-gray-500 mb-1">Difficulty Level</div>
              <div className="text-sm font-semibold text-gray-700">
                {trainingMode === 'reverse' 
                  ? reverseZipfLevel.toFixed(2)
                  : zipfLevels[currentPartOfSpeech || 'default'].toFixed(2)}
                {trainingMode === 'normal' && currentPartOfSpeech && (
                  <span className="text-xs text-gray-500 ml-1">({currentPartOfSpeech})</span>
                )}
              </div>
            </div>
          </div>

          {/* Parts of Speech Selection - Only for Normal Mode */}
          {trainingMode === 'normal' && (
            <div className="flex gap-2 flex-wrap">
              {PARTS_OF_SPEECH.map((pos) => (
                <label key={pos} className="inline-flex items-center">
                  <input
                    type="checkbox"
                    className="form-checkbox rounded text-blue-600"
                    checked={activePartsOfSpeech.includes(pos)}
                    onChange={() => togglePartOfSpeech(pos)}
                  />
                  <span className="ml-2 capitalize">{pos}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Normal Mode - Definition Display */}
        {trainingMode === 'normal' && currentWord && definitions[currentDefIndex] && (
          <div className="space-y-4">
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-medium">
                  Definition{' '}
                  {definitions.length > 1 &&
                    `(${currentDefIndex + 1}/${definitions.length})`}
                </h3>
                {definitions.length > 1 && (
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setCurrentDefIndex(
                          (prev) =>
                            (prev - 1 + definitions.length) %
                            definitions.length,
                        )
                      }
                      className="text-gray-600 hover:text-gray-800"
                    >
                      ← Previous
                    </button>
                    <button
                      onClick={() =>
                        setCurrentDefIndex(
                          (prev) => (prev + 1) % definitions.length,
                        )
                      }
                      className="text-gray-600 hover:text-gray-800"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
              <p className="text-xl">
                {definitions[currentDefIndex].definition}
              </p>
              {displayPreferences.showExamples &&
                definitions[currentDefIndex].example && (
                  <p className="text-gray-600 mt-2 italic">
                    Example: {definitions[currentDefIndex].example}
                  </p>
                )}
              <p className="text-sm text-gray-500 mt-1">
                ({definitions[currentDefIndex].partOfSpeech})
              </p>
              {displayPreferences.showSynonyms &&
                definitions[currentDefIndex].synonyms?.length > 0 && (
                  <p className="text-sm text-gray-600 mt-2">
                    Synonyms:{' '}
                    {definitions[currentDefIndex].synonyms.join(', ')}
                  </p>
                )}
            </div>

            {/* Word Display */}
            {showAnswer ? (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold text-green-600">
                  {currentWord}
                </h2>
              </div>
            ) : (
              <button
                onClick={() => setShowAnswer(true)}
                className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Show Word
              </button>
            )}

            {/* Difficulty Buttons */}
            {showAnswer && (
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => handleDifficulty(false)}
                  className="flex-1 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
                >
                  Easy
                </button>
                <button
                  onClick={() => handleDifficulty(true)}
                  className="flex-1 px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
                >
                  Difficult
                </button>
              </div>
            )}
          </div>
        )}

        {/* Reverse Mode - Word Display and Definition Input */}
        {trainingMode === 'reverse' && currentWord && (
          <div className="space-y-6">
            {/* Word Display */}
            <div className="text-center bg-gradient-to-r from-blue-50 to-indigo-50 p-8 rounded-xl border border-blue-100">
              <div className="inline-block bg-white px-6 py-3 rounded-lg shadow-sm border border-blue-200 mb-4">
                <h2 className="text-4xl font-bold text-blue-600">
                  {currentWord}
                </h2>
              </div>
              <p className="text-lg text-gray-700">
                How would you define this word?
              </p>
            </div>

            {/* Definition Input */}
            <div className="space-y-4">
              <div className="relative">
                <textarea
                  value={userDefinition}
                  onChange={(e) => setUserDefinition(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      if (userDefinition.trim() && !grading && score === null && geminiApiKey) {
                        gradeDefinition(currentWord, userDefinition);
                      }
                    }
                  }}
                  placeholder="Type your definition here... Be as detailed and accurate as possible!"
                  className="w-full h-36 px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-700 placeholder-gray-400"
                  disabled={grading || score !== null}
                />
                <div className="absolute bottom-3 right-3 text-xs text-gray-400">
                  {userDefinition.length} characters
                </div>
              </div>
              
              {score === null && (
                <button
                  onClick={() => gradeDefinition(currentWord, userDefinition)}
                  disabled={!userDefinition.trim() || grading || !geminiApiKey}
                  className="w-full px-6 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl hover:from-blue-600 hover:to-blue-700 disabled:from-gray-400 disabled:to-gray-400 disabled:cursor-not-allowed font-medium transition-all duration-200 shadow-sm"
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
                    ? 'bg-gradient-to-r from-green-50 to-emerald-50 border-green-200' 
                    : 'bg-gradient-to-r from-red-50 to-pink-50 border-red-200'
                }`}>
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-xl font-bold text-gray-800">
                        Score: {score}/5
                      </h3>
                      <div className="flex items-center mt-1">
                        {[1, 2, 3, 4, 5].map(i => (
                          <div key={i} className={`w-3 h-3 rounded-full mr-1 ${
                            i <= score ? 'bg-yellow-400' : 'bg-gray-200'
                          }`}></div>
                        ))}
                      </div>
                    </div>
                    <span className={`px-4 py-2 rounded-full text-sm font-bold ${
                      score >= 3 
                        ? 'bg-green-200 text-green-800' 
                        : 'bg-red-200 text-red-800'
                    }`}>
                      {score >= 3 ? 'Correct!' : 'Keep Trying'}
                    </span>
                  </div>
                  
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="bg-white p-4 rounded-lg border border-gray-100">
                      <h4 className="font-semibold text-gray-800 mb-2">
                        Correct Definition
                      </h4>
                      <p className="text-gray-700 leading-relaxed">{correctDefinition}</p>
                    </div>
                    <div className="bg-white p-4 rounded-lg border border-gray-100">
                      <h4 className="font-semibold text-gray-800 mb-2">
                        Your Definition
                      </h4>
                      <p className="text-gray-600 italic leading-relaxed">{userDefinition}</p>
                    </div>
                  </div>
                </div>
                
                <button
                  onClick={handleNextWordReverse}
                  className="w-full px-6 py-4 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-xl hover:from-indigo-600 hover:to-purple-700 font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl"
                >
                  Next Word
                </button>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
};

export default ZipfTrainer;
