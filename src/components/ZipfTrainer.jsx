// src/components/ZipfTrainer.jsx
import React, { useState, useEffect } from 'react';

const ZIPF_ADJUSTMENT = 0.05;
const ZIPF_RANGE = 0.1;

// Get settings from localStorage or use defaults
const getStoredSettings = () => {
  const saved = localStorage.getItem('trainerSettings');
  return saved ? JSON.parse(saved) : {
    displayPreferences: {
      showExamples: false,
      showSynonyms: false
    },
    currentZipf: 5.0
  };
};

const ZipfTrainer = () => {
  const [wordData, setWordData] = useState(null);
  const [currentWord, setCurrentWord] = useState(null);
  const storedSettings = getStoredSettings();
  const [currentZipf, setCurrentZipf] = useState(storedSettings.currentZipf);
  const [definitions, setDefinitions] = useState([]);
  const [currentDefIndex, setCurrentDefIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAnswer, setShowAnswer] = useState(false);
  const [displayPreferences, setDisplayPreferences] = useState(storedSettings.displayPreferences);

  // Save all settings whenever they change
  useEffect(() => {
    localStorage.setItem('trainerSettings', JSON.stringify({
      displayPreferences,
      currentZipf
    }));
  }, [displayPreferences, currentZipf]);

  // Load word frequency data
  useEffect(() => {
    fetch('/data/en_frequencies.json')
      .then(response => response.json())
      .then(data => {
        setWordData(data.words);
        setLoading(false);
      })
      .catch(error => console.error('Error loading word data:', error));
  }, []);

  const getWordsInZipfRange = (targetZipf) => {
    if (!wordData) return [];

    const minZipf = targetZipf - ZIPF_RANGE/2;
    const maxZipf = targetZipf + ZIPF_RANGE/2;

    return Object.entries(wordData)
      .filter(([_, data]) => 
        data.zipf >= minZipf && data.zipf <= maxZipf
      )
      .map(([word]) => word);
  };

  const fetchWordDefinition = async (word) => {
    try {
      const response = await fetch(
        `https://api.dictionaryapi.dev/api/v2/entries/en/${word}`
      );
      
      if (!response.ok) {
        throw new Error('Word not found');
      }

      const data = await response.json();
      
      // Collect all definitions from all meanings
      const allDefinitions = data[0].meanings.flatMap(meaning => 
        meaning.definitions.map(def => ({
          definition: def.definition,
          partOfSpeech: meaning.partOfSpeech,
          example: def.example,
          synonyms: meaning.synonyms
        }))
      );

      setDefinitions(allDefinitions);
      setCurrentDefIndex(0);
    } catch (error) {
      console.error('Error fetching definition:', error);
      // Try another word
      selectNewWord();
    }
  };

  const selectNewWord = () => {
    const wordsInRange = getWordsInZipfRange(currentZipf);
    if (wordsInRange.length === 0) {
      console.error('No words found in range');
      return;
    }
    
    const randomWord = wordsInRange[
      Math.floor(Math.random() * wordsInRange.length)
    ];
    
    setCurrentWord(randomWord);
    setShowAnswer(false);
    fetchWordDefinition(randomWord);
  };

  useEffect(() => {
    if (!loading) {
      selectNewWord();
    }
  }, [loading, currentZipf]);

  const handleDifficulty = (harder) => {
    setCurrentZipf(prev => 
      harder ? prev + ZIPF_ADJUSTMENT : prev - ZIPF_ADJUSTMENT
    );
  };

  const cycleDefinition = () => {
    setCurrentDefIndex(prev => 
      (prev + 1) % definitions.length
    );
  };

  const togglePreference = (key) => {
    setDisplayPreferences(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  if (loading) {
    return <div className="text-center py-8">Loading word data...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="bg-white rounded-lg shadow-md p-6">
        {/* Settings and Zipf Level */}
        <div className="flex justify-between items-center mb-6">
          <div className="space-x-4">
            <label className="inline-flex items-center">
              <input
                type="checkbox"
                className="form-checkbox rounded text-blue-600"
                checked={displayPreferences.showExamples}
                onChange={() => togglePreference('showExamples')}
              />
              <span className="ml-2">Show Examples</span>
            </label>
            <label className="inline-flex items-center">
              <input
                type="checkbox"
                className="form-checkbox rounded text-blue-600"
                checked={displayPreferences.showSynonyms}
                onChange={() => togglePreference('showSynonyms')}
              />
              <span className="ml-2">Show Synonyms</span>
            </label>
          </div>
          <div className="text-sm text-gray-600">
            Current Zipf Level: {currentZipf.toFixed(2)}
          </div>
        </div>

        {/* Definition Display */}
        {currentWord && definitions[currentDefIndex] && (
          <div className="space-y-4">
            <div className="relative">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-lg font-medium">Definition{' '}
                  {definitions.length > 1 && 
                    `(${currentDefIndex + 1}/${definitions.length})`}
                </h3>
                {definitions.length > 1 && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setCurrentDefIndex((prev) => (prev - 1 + definitions.length) % definitions.length)}
                      className="text-gray-600 hover:text-gray-800"
                    >
                      ← Previous
                    </button>
                    <button
                      onClick={() => setCurrentDefIndex((prev) => (prev + 1) % definitions.length)}
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
              {displayPreferences.showExamples && definitions[currentDefIndex].example && (
                <p className="text-gray-600 mt-2 italic">
                  Example: {definitions[currentDefIndex].example}
                </p>
              )}
              <p className="text-sm text-gray-500 mt-1">
                ({definitions[currentDefIndex].partOfSpeech})
              </p>
              {displayPreferences.showSynonyms && definitions[currentDefIndex].synonyms?.length > 0 && (
                <p className="text-sm text-gray-600 mt-2">
                  Synonyms: {definitions[currentDefIndex].synonyms.join(", ")}
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