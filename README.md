# Fluency Training

[![GitHub Pages Status](https://img.shields.io/github/deployments/GiladKingsley/Fluency-Training/github-pages?label=GitHub%20Pages&logo=github)](https://giladkingsley.github.io/Fluency-Training/)

This project is designed to enhance **spoken fluency** by focusing on the active retrieval of words based on their definitions. It addresses the need for targeted output practice, going beyond passive language input methods like reading.

## The Importance of Output Practice

Developing fluency, characterized by "continuity, smoothness, rate, and effort in speech production," requires more than just consuming language through reading. While reading is valuable, it doesn't directly train the ability to produce language efficiently. To become truly fluent, we need to actively practice **output** - generating and articulating our thoughts into words.

## Simulating "Tip of the Tongue" Moments

This app tackles output practice by simulating those frustrating yet insightful "tip of the tongue" moments. You are presented with a **definition**, and your task is to recall the corresponding **word** (or words). This process mimics real-life situations where you have a clear concept in mind but need to find the right words to express it.

By engaging in this active retrieval process, you strengthen the mental connections between concepts and their corresponding vocabulary, making it easier to access these words during spontaneous speech.

## Adaptive Difficulty for Optimal Challenge

The app incorporates an **adaptive difficulty** mechanism to ensure you're consistently challenged at the right level. It leverages data on word rarity (frequency of use) to dynamically adjust the difficulty:

*   **Success:** You'll be presented with rarer, more challenging words.
*   **Struggle:** The app will provide more common, easier-to-recall words.

This personalized approach keeps you engaged and promotes continuous improvement in your ability to retrieve words across a wide range of vocabulary.

## Features

*   **Definition-Based Retrieval:** Practice recalling words based on their definitions.
*   **Adaptive Difficulty:** Automatically adjusts word rarity based on your performance.
*   **Synonym Option:** Choose to include synonyms for a broader vocabulary challenge.
*   **Data-Driven:** Uses a comprehensive dictionary and word frequency data for accurate and relevant word selection.

## Tech Stack

*   **React:** A JavaScript library for building user interfaces.
*   **Vite:** A fast build tool and development server.
*   **Tailwind CSS:** A utility-first CSS framework for rapid styling.
*   **Dictionary API:** Used to fetch definitions, synonyms, and other word data.

## Getting Started

1. **Clone the repository:**

    ```bash
    git clone https://github.com/GiladKingsley/Fluency-Training.git
    ```

2. **Install dependencies:**

    ```bash
    cd Fluency-Training
    npm install
    ```

3. **Run the development server:**

    ```bash
    npm run dev
    ```

    This will start the app in development mode. Open your browser and visit `http://localhost:5173` (or the port indicated in your terminal) to view it.

## Contributing

Contributions are welcome! If you have ideas for improvements, bug fixes, or new features, please feel free to open an issue or submit a pull request.

## License

## License

This project is licensed under the [CC BY-NC 4.0 License](LICENSE.md).