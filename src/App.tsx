import FactoryPage from "./FactoryPage";
import "./style.css";

function App() {
  return (
    <div className="w-full h-screen bg-gray-100 flex flex-col">
      <header className="bg-blue-600 text-white">
        <div className="p-5 text-center border-b border-blue-700">
          <h1 className="text-2xl font-semibold">Factory Simulator</h1>
          <p className="text-sm mt-1 opacity-90">
            AI-Powered Factory Simulation
          </p>
        </div>
      </header>
      <FactoryPage />
    </div>
  );
}

export default App;
