import React, { useState } from 'react';
import { User, CreditCard, Shield, Monitor, ChevronRight, Lock } from 'lucide-react';
import { Button, Input, Badge } from '../components/ui/Generic';
import { cn } from '../lib/cn';

export const SettingsPage = () => {
  const [activeTab, setActiveTab] = useState('profile');

  const tabs = [
    { id: 'profile', label: 'My Account', icon: User, desc: 'Personal details' },
    { id: 'billing', label: 'Subscription', icon: CreditCard, desc: 'Plan & payment' },
    { id: 'preferences', label: 'Preferences', icon: Monitor, desc: 'App appearance' },
    { id: 'security', label: 'Security', icon: Shield, desc: 'Password & 2FA' },
  ];

  return (
    <div className="flex h-full bg-[#f8f9fa] font-sans overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-10">
          
          <div className="mb-8">
            <h1 className="text-3xl font-serif font-bold text-slate-900 mb-2 tracking-tight">Settings</h1>
            <p className="text-slate-500 text-lg">Manage your account, billing, and workspace preferences.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-8 lg:gap-10 items-start">
            {/* Sidebar Navigation - Clean List Style */}
            <nav className="space-y-2 sticky top-6">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "group flex items-center gap-3 w-full px-4 py-3 text-sm font-medium rounded-xl transition-all text-left",
                    activeTab === tab.id 
                      ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" 
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-100/50"
                  )}
                >
                    <tab.icon className={cn(
                        "h-5 w-5 transition-colors", 
                        activeTab === tab.id ? "text-amber-500" : "text-slate-400 group-hover:text-slate-600"
                    )} />
                    <span className="flex-1">{tab.label}</span>
                    {activeTab === tab.id && <ChevronRight className="h-4 w-4 text-slate-300" />}
                </button>
              ))}
            </nav>

            {/* Content Area */}
            <div className="min-w-0 space-y-8">
              
              {activeTab === 'profile' && (
                <div className="animate-fade-in space-y-8">
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="p-6 sm:p-8 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
                        <div className="h-20 w-20 rounded-full bg-slate-100 border-4 border-white shadow-lg flex items-center justify-center text-2xl font-bold text-slate-400 shrink-0 relative group cursor-pointer overflow-hidden">
                            <span className="group-hover:opacity-0 transition-opacity">JD</span>
                            <div className="absolute inset-0 bg-slate-900/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white text-[10px] font-bold uppercase tracking-wide backdrop-blur-sm">
                                Change
                            </div>
                        </div>
                        <div className="flex-1">
                            <h2 className="text-xl font-bold text-slate-900 font-serif">Jane Doe</h2>
                            <p className="text-slate-500 text-sm mb-3">RCIC #R123456</p>
                            <div className="flex gap-2">
                                <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-100 px-2.5 py-0.5">Verified</Badge>
                                <Badge variant="outline" className="bg-slate-50 text-slate-500">Member since 2021</Badge>
                            </div>
                        </div>
                        <Button variant="outline" size="sm" className="hidden sm:flex">Public Page</Button>
                    </div>

                    <div className="p-6 sm:p-8 grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700">First Name</label>
                        <Input defaultValue="Jane" />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-semibold text-slate-700">Last Name</label>
                        <Input defaultValue="Doe" />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                         <label className="text-sm font-semibold text-slate-700">Professional Designation</label>
                         <Input defaultValue="Regulated Canadian Immigration Consultant (RCIC)" />
                      </div>
                      <div className="space-y-2 md:col-span-2">
                         <label className="text-sm font-semibold text-slate-700">Bio</label>
                         <textarea 
                            className="flex min-h-[100px] w-full rounded-xl border border-slate-200 bg-slate-50/30 px-3 py-2 text-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10 transition-all resize-y" 
                            defaultValue="Specializing in complex refusals and H&C applications." 
                         />
                         <p className="text-[11px] text-slate-400 text-right">240 characters left</p>
                      </div>
                    </div>
                    
                    <div className="bg-slate-50 p-4 sm:p-6 flex justify-end gap-3 border-t border-slate-100">
                      <Button variant="ghost">Cancel</Button>
                      <Button className="bg-slate-900 text-white hover:bg-black">Save Changes</Button>
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'billing' && (
                 <div className="animate-fade-in space-y-6">
                    <div className="bg-slate-900 rounded-2xl p-6 sm:p-8 text-white shadow-xl shadow-slate-900/5 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-80 h-80 bg-gradient-to-br from-amber-400 to-orange-600 rounded-full mix-blend-overlay filter blur-[60px] opacity-20 -mr-20 -mt-20"></div>
                        <div className="relative z-10">
                            <div className="flex justify-between items-start mb-6">
                                <div>
                                    <p className="text-slate-400 text-xs font-bold uppercase tracking-wider mb-1">Current Plan</p>
                                    <h2 className="text-3xl font-serif font-bold">Professional</h2>
                                </div>
                                <Badge className="bg-white text-slate-900 border-none font-bold">ACTIVE</Badge>
                            </div>
                            
                            <div className="grid sm:grid-cols-3 gap-6 mb-8 pt-6 border-t border-white/10">
                                <div>
                                    <p className="text-slate-400 text-xs mb-1">Price</p>
                                    <p className="font-medium">$49<span className="text-slate-500 text-sm">/mo</span></p>
                                </div>
                                <div>
                                    <p className="text-slate-400 text-xs mb-1">Renewal</p>
                                    <p className="font-medium">Oct 24, 2024</p>
                                </div>
                                <div>
                                    <p className="text-slate-400 text-xs mb-1">Payment</p>
                                    <div className="flex items-center gap-2">
                                        <div className="bg-white/10 p-0.5 rounded"><CreditCard className="h-3 w-3" /></div>
                                        <span className="font-medium text-sm">•••• 4242</span>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="flex gap-3">
                                <Button variant="outline" className="border-white/20 text-white hover:bg-white/10 hover:border-white/40 bg-transparent h-9 text-xs">Download Invoices</Button>
                                <Button className="bg-white text-slate-900 hover:bg-slate-100 border-none h-9 text-xs">Manage Subscription</Button>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 sm:p-6">
                        <h3 className="font-bold text-slate-900 mb-4 text-sm uppercase tracking-wide">Usage Limits</h3>
                        <div className="space-y-5">
                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-slate-600">AI Queries</span>
                                    <span className="font-bold text-slate-900">842 / Unlimited</span>
                                </div>
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full w-[15%] bg-amber-500 rounded-full"></div>
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between text-sm mb-2">
                                    <span className="text-slate-600">Memo Exports</span>
                                    <span className="font-bold text-slate-900">12 / 50</span>
                                </div>
                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                    <div className="h-full w-[24%] bg-blue-500 rounded-full"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                 </div>
              )}

              {activeTab === 'preferences' && (
                <div className="animate-fade-in bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100">
                    <div className="p-5 sm:p-6">
                        <h3 className="font-bold text-slate-900 mb-1">Interface</h3>
                        <p className="text-sm text-slate-500 mb-6">Customize how the application looks and feels.</p>
                        
                        <div className="space-y-5">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-700">Theme</span>
                                <div className="flex gap-2 bg-slate-50 p-1 rounded-lg border border-slate-100">
                                    <button className="px-3 py-1.5 rounded-md bg-white shadow-sm text-xs font-medium text-slate-900">Light</button>
                                    <button className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-500 hover:text-slate-900">Dark</button>
                                    <button className="px-3 py-1.5 rounded-md text-xs font-medium text-slate-500 hover:text-slate-900">System</button>
                                </div>
                            </div>
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-700">Citation Style</span>
                                <select className="text-sm border-slate-200 rounded-md py-1.5 bg-white text-slate-700 focus:ring-slate-900/10">
                                    <option>McGill Guide (Standard)</option>
                                    <option>Simple (Case Name)</option>
                                </select>
                            </div>
                        </div>
                    </div>
                    
                    <div className="p-5 sm:p-6">
                        <h3 className="font-bold text-slate-900 mb-1">Notifications</h3>
                        <p className="text-sm text-slate-500 mb-6">Choose what updates you want to receive.</p>
                        
                        <div className="space-y-4">
                             {[
                               'New feature announcements', 
                               'Weekly case law digest', 
                               'Security alerts'
                             ].map((label, i) => (
                                 <label key={i} className="flex items-center gap-3 cursor-pointer">
                                     <input type="checkbox" className="rounded border-slate-300 text-slate-900 focus:ring-slate-900" defaultChecked={i === 2} />
                                     <span className="text-sm text-slate-700">{label}</span>
                                 </label>
                             ))}
                        </div>
                    </div>
                </div>
              )}

              {activeTab === 'security' && (
                <div className="animate-fade-in bg-white rounded-2xl border border-slate-200 p-8 sm:p-10 text-center shadow-sm">
                    <div className="h-14 w-14 bg-slate-50 rounded-full flex items-center justify-center mb-6 mx-auto">
                        <Lock className="h-7 w-7 text-slate-400" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 mb-2">SSO Enabled</h3>
                    <p className="text-slate-500 mb-8 max-w-sm mx-auto text-sm leading-relaxed">
                        Your organization uses Single Sign-On. Security settings are managed by your identity provider administrator.
                    </p>
                    <Button variant="outline" className="min-w-[140px]">View Logs</Button>
                </div>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
