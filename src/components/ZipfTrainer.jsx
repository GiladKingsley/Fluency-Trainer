import React, { useState, useEffect } from 'react';

const ZIPF_ADJUSTMENT = 0.05;
const ZIPF_RANGE = 0.1;

const ZipfTrainer = () => {
  const [wordData, setWordData] = useState(null);
  const [currentWord, setCurrentWord] = useState(null);
  const [currentZipf, setCurrentZipf] = useState(5.0);
  const [definitions, setDefinitions] = useState([]);
  const [currentDefIndex, setCurrentDefIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showAnswer, setShowAnswer] = useState(false);

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
          example: def.example
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

  if (loading) {
    return <div className="text-center py-8">Loading word data...</div>;
  }

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="bg-white rounded-lg shadow-md p-6">
        {/* Current Zipf Level */}
        <div className="text-sm text-gray-600 mb-4">
          Current Zipf Level: {currentZipf.toFixed(2)}
        </div>

        {/* Definition Display */}
        {currentWord && definitions[currentDefIndex] && (
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium">Definition 
                {definitions.length > 1 && 
                  ` (${currentDefIndex + 1}/${definitions.length})`}:
              </h3>
              <p className="text-xl mt-2">
                {definitions[currentDefIndex].definition}
              </p>
              {definitions[currentDefIndex].example && (
                <p className="text-gray-600 mt-2 italic">
                  Example: {definitions[currentDefIndex].example}
                </p>
              )}
              <p className="text-sm text-gray-500 mt-1">
                ({definitions[currentDefIndex].partOfSpeech})
              </p>
            </div>

            {/* Word Display */}
            {showAnswer ? (
              <div className="space-y-4">
                <h2 className="text-2xl font-bold text-green-600">
                  {currentWord}
                </h2>
                {definitions.length > 1 && (
                  <button
                    onClick={cycleDefinition}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                  >
                    Next Definition
                  </button>
                )}
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