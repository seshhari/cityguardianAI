import { BrowserRouter, Route, Routes } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import Dashboard from './pages/Dashboard';
import FloodRiskMap from './pages/FloodRiskMap';
import SensorMonitoring from './pages/SensorMonitoring';
import RiskAnalysis from './pages/RiskAnalysis';
import EvacuationPlanner from './pages/EvacuationPlanner';
import AlertsCenter from './pages/AlertsCenter';
import Settings from './pages/Settings';
import RescueDispatch from './pages/RescueDispatch';
import EvacuationOperations from './pages/EvacuationOperations';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/map" element={<FloodRiskMap />} />
          <Route path="/sensors" element={<SensorMonitoring />} />
          <Route path="/analysis" element={<RiskAnalysis />} />
          <Route path="/routes" element={<EvacuationPlanner />} />
          <Route path="/evacuation" element={<EvacuationOperations />} />
          <Route path="/rescue-dispatch" element={<RescueDispatch />} />
          <Route path="/alerts" element={<AlertsCenter />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
