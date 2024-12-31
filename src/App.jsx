import ZipfTrainer from './components/ZipfTrainer'

function App() {
  return (
    <div className="min-h-screen bg-gray-100 py-8">
      <h1 className="text-3xl font-bold text-center mb-8">
        Fluency Trainer
      </h1>
      <ZipfTrainer />
    </div>
  )
}

export default App