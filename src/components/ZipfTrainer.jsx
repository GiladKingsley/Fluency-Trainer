import React, { useState, useEffect, useCallback } from 'react';

const ZIPF_ADJUSTMENT = 0.05;
const ZIPF_RANGE = 0.1;
const PARTS_OF_SPEECH = ['noun', 'verb', 'adjective', 'adverb'];

const getInitialState = () => {
  const savedPreferences = localStorage.getItem('displayPreferences');
  const savedZipfLevels = localStorage.getItem('zipfLevels');
  const savedPartsOfSpeech = localStorage.getItem('activePartsOfSpeech');

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
  } = getInitialState();
  const [displayPreferences, setDisplayPreferences] =
    useState(initialPreferences);
  const [zipfLevels, setZipfLevels] = useState(initialZipfLevels);
  const [activePartsOfSpeech, setActivePartsOfSpeech] =
    useState(initialActivePos);

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

  const selectNewWord = useCallback(async () => {
    if (!wordData) return;

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
  }, [wordData, getWordsInZipfRange, fetchWordDefinition]);

  // Load word frequency data
  useEffect(() => {
    fetch('/data/en_frequencies.json')
      .then((response) => response.json())
      .then((data) => {
        setWordData(data.words);
        setLoading(false);
      })
      .catch((error) => {
        console.error('Error loading word data:', error);
        setLoading(false);
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

  // Select new word when relevant state changes
  useEffect(() => {
    if (!loading && wordData) {
      selectNewWord();
    }
  }, [loading, wordData, zipfLevels, activePartsOfSpeech, selectNewWord]);

  const handleDifficulty = (harder) => {
    const pos = currentPartOfSpeech || 'default';
    setZipfLevels((prev) => ({
      ...prev,
      [pos]: harder
        ? prev[pos] + ZIPF_ADJUSTMENT
        : prev[pos] - ZIPF_ADJUSTMENT,
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

  if (loading) {
    return <div className="text-center py-8">Loading word data...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="bg-white rounded-lg shadow-md p-6">
        {/* Settings and Zipf Level */}
        <div className="flex flex-col gap-4 mb-6">
          <div className="flex justify-between items-center">
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
            <div className="text-sm text-gray-600">
              Current Zipf Level:{' '}
              {zipfLevels[currentPartOfSpeech || 'default'].toFixed(2)}
              {currentPartOfSpeech && ` (${currentPartOfSpeech})`}
            </div>
          </div>

          {/* Parts of Speech Selection */}
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
        </div>

        {/* Definition Display */}
        {currentWord && definitions[currentDefIndex] && (
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
      </div>
    </div>
  );
};

export default ZipfTrainer;
